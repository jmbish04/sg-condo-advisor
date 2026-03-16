/**
 * AI Provider Registry & Unified Interface
 * 
 * This module serves as the primary router for all AI provider integrations.
 * It defines unified types for options, responses, and model capabilities,
 * and handles automatic provider-to-provider fallback logic.
 * 
 * @module AI/Providers
 */
import { resolveDefaultAiProvider, SupportedProvider } from "./config";
import * as openai from "./openai";
import * as gemini from "./gemini";
import * as anthropic from "./anthropic";
import * as workerAi from "./worker-ai";

/**
 * metadata for an AI provider fallback event.
 */
export interface FallbackAlert {
  fallbackUsed: boolean;
  originalProvider: string;
  errorMessage: string;
}

/**
 * configuration options for AI generation requests.
 */
export interface AIOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  sanitize?: boolean;
  effort?: "low" | "medium" | "high";
  onFallback?: (alert: FallbackAlert) => void;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface TextWithToolsResponse {
  text: string;
  toolCalls: ToolCall[];
}

export interface StructuredWithToolsResponse<T> {
  data: T;
  toolCalls: ToolCall[];
}

export type ModelCapability = 

  | 'structured_response' 
  | 'high_reasoning' 
  | 'fast' 

  | 'vision' 
  | 'function_calling';

/**
 * Unified model definition string across all providers.
 */
export interface UnifiedModel {
  /** Unique API ID (e.g., "gpt-4o") */
  id: string;
  /** Provider key: 'google' | 'openai' | 'anthropic' | 'cloudflare' */
  provider: string;
  /** Human-friendly name */
  name: string;
  description: string;
  capabilities: ModelCapability[];
  /** Context window or output limit */
  maxTokens?: number;
  /** Original response for debugging */
  raw: any;
}

export type ModelFilter = ModelCapability;

/**
 * Core Routing Functions
 */

/**
 * Verifies API connectivity for a specific or default provider.
 */
export async function verifyApiKey(env: Env, providerOverride?: SupportedProvider): Promise<boolean> {
  const provider = providerOverride || resolveDefaultAiProvider(env);
  switch (provider) {
    case 'openai': return openai.verifyApiKey(env);
    case 'gemini': return gemini.verifyApiKey(env);
    case 'anthropic': return anthropic.verifyApiKey(env);
    default: return workerAi.verifyApiKey(env);
  }
}

/**
 * Universal text generation function with automatic fallback.
 * Routes to the appropriate provider and retries with Workers AI on failure.
 * 
 * @param env - Cloudflare Environment bindings.
 * @param prompt - User input.
 * @param systemPrompt - Optional role/instructions.
 * @param options - Generation settings.
 * @param providerOverride - Force a specific provider.
 */
export async function generateText(
  env: Env,
  prompt: string,
  systemPrompt?: string,
  options?: AIOptions,
  providerOverride?: SupportedProvider
): Promise<string> {
  const provider = providerOverride || resolveDefaultAiProvider(env);
  
  try {
    switch (provider) {
      case 'openai': return await openai.generateText(env, prompt, systemPrompt, options);
      case 'gemini': return await gemini.generateText(env, prompt, systemPrompt, options);
      case 'anthropic': return await anthropic.generateText(env, prompt, systemPrompt, options);
      case 'worker-ai': return await workerAi.generateText(env, prompt, systemPrompt, options);
      default: return await workerAi.generateText(env, prompt, systemPrompt, options);
    }
  } catch (error: any) {
    if (provider !== 'worker-ai') {
      const alert: FallbackAlert = { fallbackUsed: true, originalProvider: provider, errorMessage: error.message || String(error) };
      console.warn(`[AI_FALLBACK] ${provider} failed during generateText. Routing to worker-ai.`, alert);
      if (options?.onFallback) options.onFallback(alert);
      return await workerAi.generateText(env, prompt, systemPrompt, options);
    }
    throw error;
  }
}

export async function generateStructuredResponse<T = any>(
  env: Env,
  prompt: string,
  schema: object,
  systemPrompt?: string,
  options?: AIOptions,
  providerOverride?: SupportedProvider
): Promise<T> {
  const provider = providerOverride || resolveDefaultAiProvider(env);
  
  try {
    switch (provider) {
      case 'openai': return await openai.generateStructuredResponse<T>(env, prompt, schema, systemPrompt, options);
      case 'gemini': return await gemini.generateStructuredResponse<T>(env, prompt, schema, systemPrompt, options);
      case 'anthropic': return await anthropic.generateStructuredResponse<T>(env, prompt, schema, systemPrompt, options);
      case 'worker-ai': return await workerAi.generateStructuredResponse<T>(env, prompt, schema, systemPrompt, options);
      default: return await workerAi.generateStructuredResponse<T>(env, prompt, schema, systemPrompt, options);
    }
  } catch (error: any) {
    if (provider !== 'worker-ai') {
      const alert: FallbackAlert = { fallbackUsed: true, originalProvider: provider, errorMessage: error.message || String(error) };
      console.warn(`[AI_FALLBACK] ${provider} failed during generateStructuredResponse. Routing to worker-ai.`, alert);
      if (options?.onFallback) options.onFallback(alert);
      return await workerAi.generateStructuredResponse<T>(env, prompt, schema, systemPrompt, options);
    }
    throw error;
  }
}

export async function generateTextWithTools(
  env: Env,
  prompt: string,
  tools: any[],
  systemPrompt?: string,
  options?: AIOptions,
  providerOverride?: SupportedProvider
): Promise<TextWithToolsResponse> {
  const provider = providerOverride || resolveDefaultAiProvider(env);
  
  try {
    switch (provider) {
      case 'openai': return await openai.generateTextWithTools(env, prompt, tools, systemPrompt, options);
      case 'gemini': return await gemini.generateTextWithTools(env, prompt, tools, systemPrompt, options);
      case 'anthropic': return await anthropic.generateTextWithTools(env, prompt, tools, systemPrompt, options);
      case 'worker-ai': return await workerAi.generateTextWithTools(env, prompt, tools, systemPrompt, options);
      default: return await workerAi.generateTextWithTools(env, prompt, tools, systemPrompt, options);
    }
  } catch (error: any) {
    if (provider !== 'worker-ai') {
      const alert: FallbackAlert = { fallbackUsed: true, originalProvider: provider, errorMessage: error.message || String(error) };
      console.warn(`[AI_FALLBACK] ${provider} failed during generateTextWithTools. Routing to worker-ai.`, alert);
      if (options?.onFallback) options.onFallback(alert);
      return await workerAi.generateTextWithTools(env, prompt, tools, systemPrompt, options);
    }
    throw error;
  }
}

export async function generateStructuredWithTools<T = any>(
  env: Env,
  prompt: string,
  schema: object,
  tools: any[],
  systemPrompt?: string,
  options?: AIOptions,
  providerOverride?: SupportedProvider
): Promise<StructuredWithToolsResponse<T>> {
  const provider = providerOverride || resolveDefaultAiProvider(env);
  
  try {
    switch (provider) {
      case 'openai': return await openai.generateStructuredWithTools<T>(env, prompt, schema, tools, systemPrompt, options);
      case 'gemini': return await gemini.generateStructuredWithTools<T>(env, prompt, schema, tools, systemPrompt, options);
      case 'anthropic': return await anthropic.generateStructuredWithTools<T>(env, prompt, schema, tools, systemPrompt, options);
      case 'worker-ai': return await workerAi.generateStructuredWithTools<T>(env, prompt, schema, tools, systemPrompt, options);
      default: return await workerAi.generateStructuredWithTools<T>(env, prompt, schema, tools, systemPrompt, options);
    }
  } catch (error: any) {
    if (provider !== 'worker-ai') {
      const alert: FallbackAlert = { fallbackUsed: true, originalProvider: provider, errorMessage: error.message || String(error) };
      console.warn(`[AI_FALLBACK] ${provider} failed during generateStructuredWithTools. Routing to worker-ai.`, alert);
      if (options?.onFallback) options.onFallback(alert);
      return await workerAi.generateStructuredWithTools<T>(env, prompt, schema, tools, systemPrompt, options);
    }
    throw error;
  }
}

export async function generateEmbedding(
  env: Env,
  text: string
): Promise<number[]> {
  return workerAi.generateEmbedding(env, text);
}

/**
 * Generates embeddings (plural) using the default embedding model.
 */
export async function generateEmbeddings(
  env: Env,
  text: string | string[]
): Promise<number[][]> {
  return workerAi.generateEmbeddings(env, text);
}

/**
 * Universal MCP & Context Helper Methods
 */

export async function rewriteQuestionForMCP(
  env: Env,
  question: string,
  context?: {
    bindings?: string[];
    libraries?: string[];
    tags?: string[];
    codeSnippets?: Array<{ file_path: string; code: string; relation: string }>;
  },
  options?: AIOptions
): Promise<string> {
  const systemPrompt = "You are a technical documentation assistant. Rewrite the user question to be clear, comprehensive, and optimized for querying Cloudflare documentation.";
  let prompt = `Original Question: ${question}\n\n`;

  if (context) {
    if (context.bindings?.length) prompt += `Bindings: ${context.bindings.join(", ")}\n`;
    if (context.libraries?.length) prompt += `Libraries: ${context.libraries.join(", ")}\n`;
    if (context.tags?.length) prompt += `Tags: ${context.tags.join(", ")}\n`;
    if (context.codeSnippets?.length) {
      prompt += `\nCode Context:\n${context.codeSnippets.map(s => `File: ${s.file_path} (${s.relation})\n${s.code.substring(0, 500)}...`).join("\n\n")}`;
    }
  }

  const schema = {
    type: "object",
    properties: {
      rewritten_question: { type: "string", description: "The technical, search-optimized question." }
    },
    required: ["rewritten_question"],
    additionalProperties: false
  };

  const result = await generateStructuredResponse<{ rewritten_question: string }>(env, prompt, schema, systemPrompt, options);
  return result.rewritten_question;
}

export async function analyzeResponseAndGenerateFollowUps(
  env: Env,
  originalQuestion: string,
  mcpResponse: any,
  options?: AIOptions
): Promise<{ analysis: string; followUpQuestions: string[] }> {
  const systemPrompt = "You are a technical documentation analyst. Analyze responses from documentation and identify gaps.";
  const prompt = `Original Question: ${originalQuestion}\n\nDocumentation Response: ${JSON.stringify(mcpResponse, null, 2)}`;

  const schema = {
    type: "object",
    properties: {
      analysis: { type: "string", description: "Analysis of whether the response answers the question." },
      followUpQuestions: { type: "array", items: { type: "string" }, description: "2-3 specific follow-up questions." }
    },
    required: ["analysis", "followUpQuestions"],
    additionalProperties: false
  };

  return await generateStructuredResponse<{ analysis: string; followUpQuestions: string[] }>(env, prompt, schema, systemPrompt, options);
}

/**
 * Aggregates available models from all active providers.
 * 
 * @param env - Cloudflare Environment bindings.
 * @param provider - Optional specific provider to fetch models for.
 * @param filter - Optional capability to filter models.
 * @returns Combined list of unified model definitions.
 */
export async function getModels(
  env: Env,
  provider?: SupportedProvider | 'google' | 'cloudflare',
  filter?: ModelFilter
): Promise<UnifiedModel[]> {
  const allModels: UnifiedModel[] = [];

  // Map 'google' to 'gemini' and 'cloudflare' to 'worker-ai' if needed, or simply handle all aliases
  const fetchProviders = provider ? [provider] : ["gemini", "openai", "anthropic", "worker-ai"] as SupportedProvider[];

  const promises = fetchProviders.map(async (p) => {
    try {
      switch (p) {
        case 'google':
        case 'gemini': return await gemini.getGoogleModels(env, filter);
        case 'openai': return await openai.getOpenAIModels(env, filter);
        case 'anthropic': return await anthropic.getAnthropicModels(env, filter);
        case 'cloudflare':
        case 'worker-ai': return await workerAi.getCloudflareModels(env, filter);
        default: return [];
      }
    } catch (e) {
      console.warn(`[getModels] failed to fetch from ${p}:`, e);
      return [];
    }
  });

  const results = await Promise.all(promises);
  results.forEach(res => allModels.push(...res));

  return allModels;
}