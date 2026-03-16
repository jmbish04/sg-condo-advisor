/**
 * Anthropic AI Provider Integration
 * 
 * Provides an interface to Anthropic's Claude models via the official SDK, 
 * routed through Cloudflare AI Gateway for observability and centralized auth.
 * Support for text generation, structured responses, and tool calling.
 * 
 * @module AI/Providers/Anthropic
 */

import { resolveDefaultAiModel } from "./config";
import { createUniversalGatewayClient, createUniversalGatewayRunner } from "../utils/gateway-client";
import { getAnthropicApiKey } from "@utils/secrets";
import { cleanJsonOutput } from "@/ai/utils/sanitizer";
import { AIOptions, TextWithToolsResponse, StructuredWithToolsResponse, UnifiedModel, ModelFilter, ToolCall } from "./index";
import { Agent, tool } from "@/ai/agents/runtime/openai";

export async function verifyApiKey(env: Env): Promise<boolean> {
  try {
    const apiKey = await getAnthropicApiKey(env);
    if (!apiKey) return false;
    const client = await createUniversalGatewayClient(env, apiKey);
    await client.chat.completions.create({
      model: "anthropic/claude-3-5-sonnet-latest",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }]
    });
    return true;
  } catch (error) {
    console.error("Anthropic Verification Error:", error);
    return false;
  }
}

async function executeWithFallback<T>(
  env: Env, originalModel: string, requiredCapability: ModelFilter | undefined,
  executionFn: (model: string) => Promise<T>
): Promise<T> {
  try {
    return await executionFn(originalModel);
  } catch (error: any) {
    console.warn(`[Anthropic Fallback] Initial execution failed for model ${originalModel}:`, error?.message);
    const models = await getAnthropicModels(env);
    const fallbackModelInfo = models.find(m => m.id !== originalModel && (!requiredCapability || m.capabilities.includes(requiredCapability)));
    
    if (!fallbackModelInfo) throw error;
    console.warn(`[Anthropic Fallback] Retrying with alternative model: ${fallbackModelInfo.id}`);
    return await executionFn(fallbackModelInfo.id);
  }
}

export async function generateText(env: Env, prompt: string, systemPrompt?: string, options?: AIOptions): Promise<string> {
  const apiKey = await getAnthropicApiKey(env);
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in environment variables");

  const initialModel = options?.model || resolveDefaultAiModel(env, "anthropic");
  return executeWithFallback(env, initialModel, undefined, async (model) => {
    const namespacedModel = model.includes('/') ? model : `anthropic/${model}`;
    const runner = await createUniversalGatewayRunner(env, apiKey, namespacedModel);
    
    const agent = new Agent({
      name: "Anthropic_Agent",
      instructions: systemPrompt || "You are a helpful assistant.",
      model: namespacedModel,
    });

    const result = await runner.run(agent, prompt);
    return String(result.finalOutput ?? "");
  });
}

export async function generateStructuredResponse<T = any>(env: Env, prompt: string, schema: object, systemPrompt?: string, options?: AIOptions): Promise<T> {
  const apiKey = await getAnthropicApiKey(env);
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in environment variables");

  const initialModel = options?.model || resolveDefaultAiModel(env, "anthropic");
  return executeWithFallback(env, initialModel, 'structured_response', async (model) => {
    const namespacedModel = model.includes('/') ? model : `anthropic/${model}`;
    const client = await createUniversalGatewayClient(env, apiKey);
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model: namespacedModel, messages, temperature: options?.temperature, max_tokens: options?.maxTokens,
      response_format: { type: "json_schema", json_schema: { name: "structured_output", schema: schema as any, strict: true } }
    });
    return JSON.parse(cleanJsonOutput(response.choices[0]?.message?.content || "{}")) as T;
  });
}

export async function generateTextWithTools(env: Env, prompt: string, tools: any[], systemPrompt?: string, options?: AIOptions): Promise<TextWithToolsResponse> {
  const apiKey = await getAnthropicApiKey(env);
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in environment variables");

  const initialModel = options?.model || resolveDefaultAiModel(env, "anthropic");
  return executeWithFallback(env, initialModel, 'function_calling', async (model) => {
    const namespacedModel = model.includes('/') ? model : `anthropic/${model}`;
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
      name: "Anthropic_Agent",
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

export async function generateStructuredWithTools<T = any>(env: Env, prompt: string, schema: object, tools: any[], systemPrompt?: string, options?: AIOptions): Promise<StructuredWithToolsResponse<T>> {
  const apiKey = await getAnthropicApiKey(env);
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in environment variables");

  const initialModel = options?.model || resolveDefaultAiModel(env, "anthropic");
  return executeWithFallback(env, initialModel, 'function_calling', async (model) => {
    const namespacedModel = model.includes('/') ? model : `anthropic/${model}`;
    const client = await createUniversalGatewayClient(env, apiKey);
    
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model: namespacedModel, messages, tools, temperature: options?.temperature, max_tokens: options?.maxTokens,
      response_format: { type: "json_schema", json_schema: { name: "structured_output", schema: schema as any, strict: true } }
    });
    const msg = response.choices[0]?.message;
    return {
      data: JSON.parse(cleanJsonOutput(msg?.content || "{}")) as T,
      toolCalls: msg?.tool_calls?.map((tc: any) => ({ id: tc.id, function: { name: tc.function?.name, arguments: tc.function?.arguments } })) || []
    };
  });
}

export async function getAnthropicModels(env: Env, filter?: ModelFilter): Promise<UnifiedModel[]> {
  try {
    const apiKey = await getAnthropicApiKey(env);
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey || "", 'anthropic-version': '2023-06-01' }
    });
    const data = await res.json() as any;
    
    const models: UnifiedModel[] = (data.data || []).map((m: any) => {
      const caps: ModelFilter[] = ['vision', 'function_calling'];
      if (m.id.includes('haiku')) caps.push('fast');
      if (m.id.includes('opus')) caps.push('high_reasoning');
      return {
        id: m.id, provider: 'anthropic', name: m.display_name || m.id,
        description: `Anthropic ${m.id} model`, capabilities: caps, raw: m
      };
    });
    return filter ? models.filter(m => m.capabilities.includes(filter)) : models;
  } catch (e) {
    return [];
  }
}
