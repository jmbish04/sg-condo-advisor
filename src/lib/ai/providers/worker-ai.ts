/**
 * Cloudflare Workers AI Provider Integration
 * 
 * Provides a unified interface to Cloudflare's native Workers AI models, 
 * utilizing the OpenAI SDK compatibility layer through AI Gateway.
 * Supports text generation, structured output, embeddings, and tool calling.
 * 
 * @module AI/Providers/WorkerAI
 */
import { resolveDefaultAiModel } from "./config";
import { cleanJsonOutput, sanitizeAndFormatResponse } from "@/ai/utils/sanitizer";
import { AIOptions, TextWithToolsResponse, StructuredWithToolsResponse, ModelCapability, UnifiedModel, ModelFilter } from "./index";
import { getCloudflareApiToken, getCloudflareAccountId, getSecret } from "@/utils/secrets";

/** Primary model for reasoning tasks (e.g., Llama 3 or GPT-OSS). */
export const REASONING_MODEL = "@cf/openai/gpt-oss-120b";
/** Primary model for structured output and tool calling tasks. */
export const STRUCTURING_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

/**
 * Initializes a new client routed through Cloudflare AI Gateway's 
 * universal/compat endpoint for Workers AI using native fetch.
 * 
 * @param env - Cloudflare Environment bindings.
 * @returns A mock OpenAI-like client object interface.
 */
async function getAIClient(env: Env): Promise<any> {
  const accountId = await getCloudflareAccountId(env);
  const gatewayId = env.AI_GATEWAY_NAME || "core-github-api";
  
  let gatewayToken = "";
  if (env.AI_GATEWAY_TOKEN) {
    gatewayToken = typeof env.AI_GATEWAY_TOKEN === 'string' 
        ? env.AI_GATEWAY_TOKEN 
        : await (env.AI_GATEWAY_TOKEN as any).get();
  }
  if (!gatewayToken) {
    gatewayToken = await getSecret(env, "AI_GATEWAY_TOKEN") || "";
  }

  const apiKey = await getCloudflareApiToken(env);
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat/chat/completions`;

  return {
    chat: {
      completions: {
        create: async (body: any) => {
          const res = await fetch(baseURL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey || "dummy-key"}`,
              "cf-aig-authorization": `Bearer ${gatewayToken}`
            },
            body: JSON.stringify(body)
          });
          if (!res.ok) throw new Error(`Gateway Error: ${await res.text()}`);
          return await res.json();
        }
      }
    }
  };
}

/**
 * Formats a model name for the Workers AI compatibility endpoint.
 * Adds the `workers-ai/` prefix if not already present.
 */
function formatModelName(model: string): string {
  return model.startsWith("workers-ai/") ? model : `workers-ai/${model}`;
}

/**
 * Verifies API connectivity with Workers AI.
 */
export async function verifyApiKey(env: Env): Promise<boolean> {
  try {
    const client = await getAIClient(env);
    await client.chat.completions.create({
      model: formatModelName(STRUCTURING_MODEL),
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
    return true;
  } catch (error) {
    console.error("Workers AI Verification Error:", error);
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
    console.warn(`[WorkerAI Fallback] Initial execution failed for model \${originalModel}:`, error?.message);
    const models = await getCloudflareModels(env);
    const requestedModelInfo = models.find(m => m.id === originalModel);
    
    if (requestedModelInfo) {
      if (requiredCapability && !requestedModelInfo.capabilities.includes(requiredCapability)) {
        console.warn(`[WorkerAI Fallback] ALERT: Specified model \${originalModel} is available but lacks capability '\${requiredCapability}'.`);
      } else {
        console.warn(`[WorkerAI Fallback] Specified model \${originalModel} is available but failed.`);
      }
    } else {
      console.warn(`[WorkerAI Fallback] Specified model \${originalModel} is NOT available in the current models list (likely deprecated).`);
    }

    const fallbackModelInfo = models.find(m => m.id !== originalModel && (!requiredCapability || m.capabilities.includes(requiredCapability)));
    if (!fallbackModelInfo) {
      console.error(`[WorkerAI Fallback] No alternative model available. Throwing original error.`);
      throw error;
    }

    console.warn(`[WorkerAI Fallback] Retrying with alternative model: \${fallbackModelInfo.id}`);
    return await executionFn(fallbackModelInfo.id);
  }
}

/**
 * Generates text using a Workers AI model.
 */
export async function generateText(
  env: Env,
  prompt: string,
  systemPrompt?: string,
  options?: AIOptions
): Promise<string> {
  const rawModel = options?.model || resolveDefaultAiModel(env, "worker-ai") || REASONING_MODEL;
  return executeWithFallback(env, rawModel, undefined, async (modelToUse) => {
    const client = await getAIClient(env);
    const model = formatModelName(modelToUse);

    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const isReasoningModel = model.includes("gpt-oss");
    const requestOptions: any = {
      model,
      messages,
    };

    if (isReasoningModel && options?.effort) {
      requestOptions.reasoning_effort = options.effort;
    }

    const response = await client.chat.completions.create(requestOptions);
    const textResult = response.choices[0]?.message?.content || "";

    if (options?.sanitize) {
      return sanitizeAndFormatResponse(textResult);
    }

    return textResult;
  });
}

/**
 * Generates a structured JSON response using Workers AI's JSON mode.
 */
export async function generateStructuredResponse<T = any>(
  env: Env,
  prompt: string,
  schema: object,
  systemPrompt?: string,
  options?: AIOptions
): Promise<T> {
  const rawModel = options?.model || STRUCTURING_MODEL;
  return executeWithFallback(env, rawModel, 'structured_response', async (modelToUse) => {
    const client = await getAIClient(env);
    const model = formatModelName(modelToUse);

    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: schema as Record<string, unknown>,
          strict: true
        }
      }
    });

    const rawJson = response.choices[0]?.message?.content || "{}";
    return JSON.parse(cleanJsonOutput(rawJson)) as T;
  });
}

export async function generateTextWithTools(
  env: Env,
  prompt: string,
  tools: any[],
  systemPrompt?: string,
  options?: AIOptions
): Promise<TextWithToolsResponse> {
  const rawModel = options?.model || STRUCTURING_MODEL;
  return executeWithFallback(env, rawModel, 'function_calling', async (modelToUse) => {
    const client = await getAIClient(env);
    const model = formatModelName(modelToUse);

    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model,
      messages,
      tools: tools as any // assumes tools are already in OpenAI format
    });

    const message = response.choices[0]?.message;
    const text = message?.content || "";
    
    const toolCalls = (message?.tool_calls || []).map((tc: any) => ({
      id: tc.id || `call_${Math.random().toString(36).substr(2, 9)}`,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      }
    }));

    return { text, toolCalls };
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
  const rawModel = options?.model || STRUCTURING_MODEL;
  return executeWithFallback(env, rawModel, 'function_calling', async (modelToUse) => {
    const client = await getAIClient(env);
    const model = formatModelName(modelToUse);

    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model,
      messages,
      tools: tools as any,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: schema as Record<string, unknown>,
          strict: true
        }
      }
    });

    const message = response.choices[0]?.message;
    const rawJson = message?.content || "{}";
    const data = JSON.parse(cleanJsonOutput(rawJson)) as T;
    
    const toolCalls = (message?.tool_calls || []).map((tc: any) => ({
      id: tc.id || `call_${crypto.randomUUID()}`,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      }
    }));

    return { data, toolCalls };
  });
}

/**
 * Generates a single vector embedding for the given text.
 * Falls back to Workers AI native execution if no OpenAI preset is detected.
 * 
 * @param env - Cloudflare Environment bindings.
 * @param text - Input text.
 * @param model - Target model identifier (e.g., '@cf/baai/bge-large-en-v1.5').
 * @returns Vector array of numbers.
 */
export async function generateEmbedding(
  env: Env,
  text: string,
  model?: string
): Promise<number[]> {
  const rawModel = model || env.DEFAULT_MODEL_EMBEDDING;
  if (!rawModel) {
    throw new Error("DEFAULT_MODEL_EMBEDDING is not set in environment variables.");
  }

  // If the model explicitly requests an OpenAI preset, route through the AI Gateway Compat endpoint
  if (rawModel.startsWith("openai/")) {
    const client = await getAIClient(env);
    const model = formatModelName(rawModel);
    try {
      const response = await client.embeddings.create({
        model,
        input: text
      });
      return response.data[0].embedding;
    } catch (error: any) {
      console.error(`Workers AI OpenAI Embedding Error (${model}):`, error);
      throw error;
    }
  }

  // Otherwise, use the standard Cloudflare Workers AI execution
  try {
    const response = await env.AI.run(rawModel as any, { text: [text] });
    return (response as any).data[0];
  } catch (error) {
    console.error(`Workers AI Native Embedding Error (${rawModel}):`, error);
    throw error;
  }
}

export async function generateEmbeddings(env: Env, text: string | string[]): Promise<number[][]> {
  const rawModel = env.DEFAULT_MODEL_EMBEDDING;
  if (!rawModel) {
    throw new Error("DEFAULT_MODEL_EMBEDDING is not set in environment variables.");
  }

  const inputArray = Array.isArray(text) ? text : [text];

  if (rawModel.startsWith("openai/")) {
    const client = await getAIClient(env);
    const model = formatModelName(rawModel);
    try {
      const response = await client.embeddings.create({
        model,
        input: inputArray
      });
      return response.data.map((d: any) => d.embedding);
    } catch (error: any) {
      console.error(`Workers AI OpenAI Embeddings Error (${model}):`, error);
      throw error;
    }
  }

  try {
    const response = await env.AI.run(rawModel as any, { text: inputArray });
    return (response as any).data;
  } catch (error) {
    console.error(`Workers AI Native Embeddings Error (${rawModel}):`, error);
    throw error;
  }
}




/**
 * Lists available Workers AI models from the Cloudflare API 
 * and transforms them into consolidated model definitions.
 */
export async function getCloudflareModels(env: Env, filter?: ModelFilter): Promise<UnifiedModel[]> {
  const token = typeof env.AI_GATEWAY_TOKEN === 'string' ? env.AI_GATEWAY_TOKEN : await (env.AI_GATEWAY_TOKEN as any).get();
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID : await (env.CLOUDFLARE_ACCOUNT_ID as any).get();
  
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models`, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  if (!res.ok) {
      throw new Error(`Failed to fetch Cloudflare models: ${res.statusText}`);
  }

  const response = await res.json() as any;
  
  // Cloudflare returns an array in 'result'
  const models: UnifiedModel[] = response.result.map((m: any) => {
    const caps: ModelFilter[] = [];
    const name = m.name.toLowerCase();
    const taskName = m.task.name.toLowerCase();
    const description = m.description.toLowerCase();

    // 1. Map Vision
    if (taskName.includes('image-to-text') || taskName.includes('text-to-image')) {
      caps.push('vision');
    }

    // 2. Map High Reasoning (Based on description/name as per your JSON example)
    if (description.includes('reasoning') || name.includes('120b') || name.includes('70b')) {
      caps.push('high_reasoning');
    }

    // 3. Map Fast (Small parameter counts or "mini" naming)
    if (name.includes('0.5b') || name.includes('3b') || name.includes('8b') || name.includes('tiny')) {
      caps.push('fast');
    }

    // 4. Map Structured Response & Function Calling
    if (taskName === 'text generation') {
      caps.push('structured_response');
      if (name.includes('llama-3') || name.includes('gpt-oss')) {
        caps.push('function_calling');
      }
    }

    // Extract Context Window from properties array
    const contextProp = m.properties?.find((p: any) => p.property_id === 'context_window');
    const maxTokens = contextProp ? parseInt(contextProp.value) : undefined;

    return {
      id: m.name,
      provider: 'cloudflare',
      name: m.name.split('/').pop() || m.name,
      description: m.description,
      capabilities: caps,
      maxTokens: maxTokens,
      raw: m
    };
  });

  return filter ? models.filter(m => m.capabilities.includes(filter)) : models;
}
