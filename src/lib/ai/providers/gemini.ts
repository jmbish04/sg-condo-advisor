/**
 * Implements the Gemini provider using the `openai/agents sdk`
 * Features:
 * 1. BYOK (Bring Your Own Key) via Cloudflare AI Gateway.
 * 2. Fetch interception to inject Gateway Auth and strip dummy keys.
 * 3. Support for text, structured JSON, vision, and function calling.
 * 4. Automatic model fallback orchestration.
 * 
 * @module AI/Providers/Gemini
 */

import { resolveDefaultAiModel } from "./config";
import { createUniversalGatewayClient, createUniversalGatewayRunner } from "../utils/gateway-client";
import { cleanJsonOutput } from "@/ai/utils/sanitizer";
import { AIOptions, TextWithToolsResponse, StructuredWithToolsResponse, UnifiedModel, ModelFilter, ToolCall } from "./index";
import { Agent, tool } from "@/ai/agents/runtime/openai";

export async function verifyApiKey(env: Env): Promise<boolean> {
  try {
    let apiKey = "cf-aig-byok-dummy-key";
    try { apiKey = await (env as any).GEMINI_API_KEY?.get() || apiKey; }
catch (e) {
  console.log(`[AI Providers - Gemini] GEMINI_API_KEY not found`, JSON.stringify(e));
}
    const client = await createUniversalGatewayClient(env, apiKey);
    await client.chat.completions.create({
      model: "google-ai-studio/gemini-2.5-flash",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }]
    });
    return true;
  } catch (error) {
    console.error("Gemini BYOK Verification Error:", error);
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
    console.warn(`[Gemini Fallback] Initial execution failed for model ${originalModel}:`, error?.message);
    const models = await getGoogleModels(env);
    const fallbackModelInfo = models.find(m => m.id !== originalModel && (!requiredCapability || m.capabilities.includes(requiredCapability)));
    
    if (!fallbackModelInfo) throw error;
    console.warn(`[Gemini Fallback] Retrying with alternative model: ${fallbackModelInfo.id}`);
    return await executionFn(fallbackModelInfo.id);
  }
}

export async function generateText(env: Env, prompt: string, systemPrompt?: string, options?: AIOptions): Promise<string> {
  let apiKey = "cf-aig-byok-dummy-key";
  try { apiKey = await (env as any).GEMINI_API_KEY?.get() || apiKey; }
catch (e) {
  console.log(`[AI Providers - Gemini] GEMINI_API_KEY not found`, JSON.stringify(e));
}

  const initialModel = options?.model || resolveDefaultAiModel(env, "gemini");
  return executeWithFallback(env, initialModel, undefined, async (model) => {
    const namespacedModel = model.includes('/') ? model : `google-ai-studio/${model}`;
    const runner = await createUniversalGatewayRunner(env, apiKey, namespacedModel);
    
    const agent = new Agent({
      name: "Gemini_Agent",
      instructions: systemPrompt || "You are a helpful assistant.",
      model: namespacedModel,
    });

    const result = await runner.run(agent, prompt);
    return String(result.finalOutput ?? "");
  });
}

export async function generateStructuredResponse<T = any>(env: Env, prompt: string, schema: object, systemPrompt?: string, options?: AIOptions): Promise<T> {
  let apiKey = "cf-aig-byok-dummy-key";
  try { apiKey = await (env as any).GEMINI_API_KEY?.get() || apiKey; }
catch (e) {
  console.log(`[AI Providers - Gemini] GEMINI_API_KEY not found`, JSON.stringify(e));
}

  const initialModel = options?.model || resolveDefaultAiModel(env, "gemini");
  return executeWithFallback(env, initialModel, 'structured_response', async (model) => {
    const namespacedModel = model.includes('/') ? model : `google-ai-studio/${model}`;
    
    // We use the raw client for JSON schema compatibility as Agents SDK `Agent` outputType expects complex typing.
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
  let apiKey = "cf-aig-byok-dummy-key";
  try { apiKey = await (env as any).GEMINI_API_KEY?.get() || apiKey; }
catch (e) {
  console.log(`[AI Providers - Gemini] GEMINI_API_KEY not found`, JSON.stringify(e));
}

  const initialModel = options?.model || resolveDefaultAiModel(env, "gemini");
  return executeWithFallback(env, initialModel, 'function_calling', async (model) => {
    const namespacedModel = model.includes('/') ? model : `google-ai-studio/${model}`;
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
      name: "Gemini_Agent",
      instructions: systemPrompt || "You are a helpful assistant.",
      model: namespacedModel,
      tools: agentTools,
      toolUseBehavior: 'stop_on_first_tool'
    });

    const result = await runner.run(agent, prompt);
    
    return {
      text: String(result.finalOutput || ""),
      toolCalls: capturedToolCalls
    };
  });
}

export async function generateStructuredWithTools<T = any>(env: Env, prompt: string, schema: object, tools: any[], systemPrompt?: string, options?: AIOptions): Promise<StructuredWithToolsResponse<T>> {
  let apiKey = "cf-aig-byok-dummy-key";
  try { apiKey = await (env as any).GEMINI_API_KEY?.get() || apiKey; }
catch (e) {
  console.log(`[AI Providers - Gemini] GEMINI_API_KEY not found`, JSON.stringify(e));
}

  const initialModel = options?.model || resolveDefaultAiModel(env, "gemini");
  return executeWithFallback(env, initialModel, 'function_calling', async (model) => {
    const namespacedModel = model.includes('/') ? model : `google-ai-studio/${model}`;
    const client = await createUniversalGatewayClient(env, apiKey);

    // Fallback to raw client for precise schema + tools handling simultaneously
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

export async function getGoogleModels(env: Env, filter?: ModelFilter): Promise<UnifiedModel[]> {
  try {
    const apiKey = await (env as any).GEMINI_API_KEY?.get() as string;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const { models } = await res.json() as any;
    
    const mapped: UnifiedModel[] = (models || []).map((m: any) => {
      const caps: ModelFilter[] = [];
      if (m.name.includes('flash')) caps.push('fast');
      if (m.name.includes('pro')) caps.push('high_reasoning');
      if (m.supportedGenerationMethods?.includes('generateContent')) caps.push('vision', 'function_calling');
      return {
        id: m.name.replace('models/', ''), provider: 'google', name: m.displayName || m.name,
        description: m.description, capabilities: caps, maxTokens: m.inputTokenLimit, raw: m
      };
    });
    return filter ? mapped.filter(m => m.capabilities.includes(filter)) : mapped;
  } catch (e) {
    return [];
  }
}