/**
 * OpenAI Provider Integration
 * 
 * Provides an interface to OpenAI's models via official openai/agents SDK, 
 * routed through Cloudflare AI Gateway. Supports Chat Completions, 
 * structured JSON (via `json_schema`), and tool calling.
 * 
 * @module AI/Providers/OpenAI
 */
import { resolveDefaultAiModel } from "./config";
import { createUniversalGatewayClient, createUniversalGatewayRunner } from "../utils/gateway-client";
import { getOpenaiApiKey } from "@utils/secrets";
import { cleanJsonOutput } from "@/ai/utils/sanitizer";
import { AIOptions, TextWithToolsResponse, StructuredWithToolsResponse, UnifiedModel, ModelFilter, ToolCall } from "./index";
import { Agent, tool } from "@/ai/agents/runtime/openai";

export async function createOpenAIClient(env: Env) {
  const apiKey = await getOpenaiApiKey(env);
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY — required for SDK auth");
  return createUniversalGatewayClient(env, apiKey);
}

export async function verifyApiKey(env: Env): Promise<boolean> {
  try {
    const client = await createOpenAIClient(env);
    await client.models.list();
    return true;
  } catch (error) {
    console.error("OpenAI Verification Error:", error);
    return false;
  }
}

async function executeWithFallback<T>(
  env: Env,
  originalModel: string,
  requiredCapability: ModelFilter | undefined,
  executionFn: (model: string) => Promise<T>
): Promise<T> {
  try {
    return await executionFn(originalModel);
  } catch (error: any) {
    console.warn(`[OpenAI Fallback] Initial execution failed for model ${originalModel}:`, error?.message);
    const models = await getOpenAIModels(env);
    const requestedModelInfo = models.find(m => m.id === originalModel);
    
    if (requestedModelInfo) {
      if (requiredCapability && !requestedModelInfo.capabilities.includes(requiredCapability)) {
        console.warn(`[OpenAI Fallback] ALERT: Specified model ${originalModel} is available but lacks capability '${requiredCapability}'.`);
      } else {
        console.warn(`[OpenAI Fallback] Specified model ${originalModel} is available but failed.`);
      }
    } else {
      console.warn(`[OpenAI Fallback] Specified model ${originalModel} is NOT available in the current models list (likely deprecated).`);
    }

    const fallbackModelInfo = models.find(m => m.id !== originalModel && (!requiredCapability || m.capabilities.includes(requiredCapability)));
    if (!fallbackModelInfo) {
      console.error(`[OpenAI Fallback] No alternative model available. Throwing original error.`);
      throw error;
    }

    console.warn(`[OpenAI Fallback] Retrying with alternative model: ${fallbackModelInfo.id}`);
    return await executionFn(fallbackModelInfo.id);
  }
}

export async function generateText(
  env: Env,
  prompt: string,
  systemPrompt?: string,
  options?: AIOptions
): Promise<string> {
  const initialModel = options?.model || resolveDefaultAiModel(env, "openai");
  return executeWithFallback(env, initialModel, undefined, async (model) => {
    const apiKey = await getOpenaiApiKey(env);
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const namespacedModel = model.includes('/') ? model : `openai/${model}`;
    const runner = await createUniversalGatewayRunner(env, apiKey, namespacedModel);
    
    const agent = new Agent({
      name: "OpenAI_Agent",
      instructions: systemPrompt || "You are a helpful assistant.",
      model: namespacedModel,
    });

    const result = await runner.run(agent, prompt);
    return String(result.finalOutput ?? "");
  });
}

export async function generateStructuredResponse<T = any>(
  env: Env,
  prompt: string,
  schema: object,
  systemPrompt?: string,
  options?: AIOptions
): Promise<T> {
  const initialModel = options?.model || resolveDefaultAiModel(env, "openai");
  return executeWithFallback(env, initialModel, 'structured_response', async (model) => {
    const client = await createOpenAIClient(env);
    const namespacedModel = model.includes('/') ? model : `openai/${model}`;
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model: namespacedModel,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: schema as any,
          strict: true
        }
      }
    });

    return JSON.parse(cleanJsonOutput(response.choices[0]?.message?.content || "{}")) as T;
  });
}

export async function generateTextWithTools(
  env: Env,
  prompt: string,
  tools: any[],
  systemPrompt?: string,
  options?: AIOptions
): Promise<TextWithToolsResponse> {
  const initialModel = options?.model || resolveDefaultAiModel(env, "openai");
  return executeWithFallback(env, initialModel, 'function_calling', async (model) => {
    const apiKey = await getOpenaiApiKey(env);
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const namespacedModel = model.includes('/') ? model : `openai/${model}`;
    const runner = await createUniversalGatewayRunner(env, apiKey, namespacedModel);

    const capturedToolCalls: ToolCall[] = [];
    const agentTools = tools.map((t, idx) => {
       const functionDef = t.function;
       return tool({
           name: functionDef.name,
           description: functionDef.description || "",
           parameters: functionDef.parameters || {},
           execute: async (args: any) => {
               capturedToolCalls.push({
                   id: `call_${idx}_${Date.now()}`,
                   function: {
                       name: functionDef.name,
                       arguments: JSON.stringify(args)
                   }
               });
               return "Tool execution deferred to caller";
           }
       });
    });

    const agent = new Agent({
      name: "OpenAI_Agent",
      instructions: systemPrompt || "You are a helpful assistant.",
      model: namespacedModel,
      tools: agentTools,
      toolUseBehavior: 'run_llm_again'
    });

    const result = await runner.run(agent, prompt);
    
    return {
      text: String(result.finalOutput || ""),
      toolCalls: capturedToolCalls
    };
  });
}

export async function generateStructuredWithTools<T = any>(
  env: Env,
  prompt: string,
  schema: object,
  tools: any[],
  systemPrompt?: string,
  options?: AIOptions
): Promise<StructuredWithToolsResponse<T>> {
  const initialModel = options?.model || resolveDefaultAiModel(env, "openai");
  return executeWithFallback(env, initialModel, 'function_calling', async (model) => {
    const client = await createOpenAIClient(env);
    const namespacedModel = model.includes('/') ? model : `openai/${model}`;
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model: namespacedModel,
      messages,
      tools,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: schema as any,
          strict: true
        }
      }
    });

    const msg = response.choices[0]?.message;
    return {
      data: JSON.parse(cleanJsonOutput(msg?.content || "{}")) as T,
      toolCalls: msg?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        function: { name: tc.function?.name, arguments: tc.function?.arguments }
      })) || []
    };
  });
}

export async function getOpenAIModels(env: Env, filter?: ModelFilter): Promise<UnifiedModel[]> {
  const client = await createOpenAIClient(env);
  const { data } = await client.models.list();
  
  const models: UnifiedModel[] = data.map((m: any) => {
    const caps: ModelFilter[] = [];
    const id = m.id.toLowerCase();

    if (id.includes('gpt-4') || id.includes('o1') || id.includes('o3')) {
        caps.push('high_reasoning', 'structured_response', 'function_calling');
    }
    if (id.includes('mini') || id.includes('turbo')) caps.push('fast');
    if (id.includes('gpt-4o') || id.includes('vision')) caps.push('vision');

    return {
      id: m.id,
      provider: 'openai',
      name: m.id,
      description: `OpenAI model ${m.id}`,
      capabilities: caps,
      raw: m
    };
  });

  return filter ? models.filter(m => m.capabilities.includes(filter)) : models;
}