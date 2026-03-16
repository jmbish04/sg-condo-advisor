/**
 * AI Configuration & Provider Resolution Module
 * 
 * Centralizes the logic for:
 * 1. AI Provider normalization and resolution from environment variables.
 * 2. Model selection for specific agent modules.
 * 3. AI Gateway URL construction according to different SDK use cases.
 * 4. Model name normalization for cross-provider compatibility.
 * 
 * @module AI/Providers/Config
 */

/** Supported AI provider identifiers. */
export type SupportedProvider =
  | 'worker-ai'
  | 'workers-ai'
  | 'openai'
  | 'gemini'
  | 'google-ai-studio'
  | 'anthropic';

/** Default fallback provider. */
export const DEFAULT_AI_PROVIDER: SupportedProvider = 'worker-ai';
/** Default high-performance model for Workers AI. */
export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * Valid SDK use cases for determining the correct Gateway endpoint format.
 */
/**
 * Defined Use Cases for AI Gateway endpoint resolution.
 * - openai_agents_sdk: Used by the repo-local compatibility runtime layered over AI Gateway.
 * - openai_sdk: Standard OpenAI client usage.
 * - worker_ai: Raw Workers AI REST interactions.
 * - google_sdk: Official Google Generative AI SDK.
 * - anthropic_sdk: Official Anthropic SDK.
 */
export type GatewayUseCase = 
  | 'openai_agents_sdk' 
  | 'openai_sdk' 
  | 'worker_ai' 
  | 'google_sdk' 
  | 'anthropic_sdk';

// ==========================================
// Model & Provider Resolution
// ==========================================

/**
 * Normalizes provider strings into the `SupportedProvider` union.
 * 
 * @param provider - Raw input string (e.g., 'Google', 'Workers-AI').
 * @returns A validated provider key.
 */
export function normalizeProvider(provider?: string): SupportedProvider {
  if (!provider) {
    return DEFAULT_AI_PROVIDER;
  }

  const normalized = provider.toLowerCase().trim();
  if (normalized === 'worker-ai' || normalized === 'workers-ai') {
    return 'worker-ai';
  }
  if (normalized === 'openai') {
    return 'openai';
  }
  if (normalized === 'gemini' || normalized === 'google' || normalized === 'google-ai-studio') {
    return 'gemini';
  }
  if (normalized === 'anthropic') {
    return 'anthropic';
  }

  return DEFAULT_AI_PROVIDER;
}

/**
 * Resolves the primary AI provider from the environment.
 * Checks `AI_DEFAULT_PROVIDER` or `AI_PROVIDER`.
 * 
 * @param env - Cloudflare Environment bindings.
 * @returns The resolved provider key.
 */
export function resolveDefaultAiProvider(env: Partial<Env>): SupportedProvider {
  const configured =
    (env as Partial<Env> & { AI_DEFAULT_PROVIDER?: string; AI_PROVIDER?: string }).AI_DEFAULT_PROVIDER ||
    (env as Partial<Env> & { AI_DEFAULT_PROVIDER?: string; AI_PROVIDER?: string }).AI_PROVIDER;
  return normalizeProvider(configured);
}

/**
 * Resolves the default AI model for a given provider or environment.
 * Handles provider-specific model defaults if not explicitly configured in `env`.
 * 
 * @param env - Cloudflare Environment bindings.
 * @param provider - Target provider to resolve for.
 * @returns The model identifier string.
 * @agent-note Use this to obtain the "standard" model for a provider when one isn't specified.
 */
export function resolveDefaultAiModel(env: Partial<Env>, provider?: SupportedProvider): string {
  const model =
    (env as Partial<Env> & { AI_DEFAULT_MODEL?: string; WORKERS_AI_MODEL?: string }).AI_DEFAULT_MODEL ||
    (env as Partial<Env> & { AI_DEFAULT_MODEL?: string; WORKERS_AI_MODEL?: string }).WORKERS_AI_MODEL;
  
  if (model && model.trim()) {
    return model.trim();
  }

  const effectiveProvider = provider || resolveDefaultAiProvider(env);
  if (effectiveProvider === 'worker-ai' || effectiveProvider === 'workers-ai') {
    return DEFAULT_WORKERS_AI_MODEL;
  }
  if (effectiveProvider === 'openai') {
    const defaultOpenAI = (env as Partial<Env> & { OPENAI_MODEL?: string }).OPENAI_MODEL || 'gpt-4o-mini';
    const openaiStr = String(defaultOpenAI);
    if (openaiStr === 'gpt-5' || openaiStr === 'gpt-5.1' || openaiStr.startsWith('gpt-5')) {
       return 'gpt-4o-mini';
    }
    return defaultOpenAI;
  }
  if (effectiveProvider === 'gemini' || effectiveProvider === 'google-ai-studio') {
    const defaultGemini = (env as Partial<Env> & { GEMINI_MODEL?: string }).GEMINI_MODEL || 'gemini-2.5-flash';
    const geminiStr = String(defaultGemini);
    if (geminiStr.includes('gemini-1.5') || geminiStr.includes('gemini-2.0')) {
       return 'gemini-2.5-flash';
    }
    return defaultGemini;
  }
  if (effectiveProvider === 'anthropic') {
    return (env as Partial<Env> & { ANTHROPIC_MODEL?: string }).ANTHROPIC_MODEL || 'claude-4-5-sonnet-latest';
  }

  return DEFAULT_WORKERS_AI_MODEL;
}

/**
 * Retrieves the configured model slug for a given agent or module.
 */
/**
 * Mapping function to retrieve task-specific model slugs.
 * Supports a global `USE_OPENAI_MODELS` toggle to switch between 
 * OpenAI (Reliability) and Workers AI (Cost) modes.
 * 
 * @param moduleName - The identifier/key for the agent module (e.g., 'finance-critic').
 * @param env - Cloudflare Environment bindings.
 * @returns The model slug to use for the agent.
 */
export const getAgentModel = (moduleName: string, env?: Env): string => {
  // Default to TRUE if env is missing or varies
  const useOpenAI = (env?.USE_OPENAI_MODELS as boolean | undefined) !== false; 

  if (useOpenAI) {
    const models: Record<string, string> = {
      'global-judge': 'openai/gpt-4o-mini',
      'warehouse': 'openai/gpt-4o-mini',
      'document-processor': 'openai/gpt-4o-mini',
      'finance': 'openai/gpt-4o-mini',
      'finance-orchestrator': 'openai/gpt-4o-mini',
      'invoice-auditor': 'openai/gpt-4o-mini',
      'finance-critic': 'openai/gpt-4o-mini',
      'legal': 'openai/gpt-4o-mini',
      'legal-orchestrator': 'openai/gpt-4o-mini',
      'warranty-analyst': 'openai/gpt-4o-mini',
      'compliance': 'openai/gpt-4o-mini',
      'compliance-orchestrator': 'openai/gpt-4o-mini',
      'license-investigator': 'openai/gpt-4o-mini',
      'timeline': 'openai/gpt-4o-mini',
      'timeline-extractor': 'openai/gpt-4o-mini',
      'timeline-evaluator': 'openai/gpt-4o-mini',
      'remedy': 'openai/gpt-4o-mini',
      'remedy-rewriter': 'openai/gpt-4o-mini',
      'recall-helper': 'openai/gpt-4o-mini',
      'default': 'openai/gpt-4o-mini',
      'fallback': 'openai/gpt-4o-mini',
    };
    return models[moduleName] || models['default'];
  } else {
    // Workers AI Models (gpt-oss-120b & llama-3.3)
    const models: Record<string, string> = {
      'global-judge': '@cf/openai/gpt-oss-120b',
      'finance-orchestrator': '@cf/openai/gpt-oss-120b',
      'legal-orchestrator': '@cf/openai/gpt-oss-120b',
      'compliance-orchestrator': '@cf/openai/gpt-oss-120b',
      'remedy': '@cf/openai/gpt-oss-120b',
      'document-processor': '@cf/openai/gpt-oss-120b',
      'warehouse': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'finance': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'invoice-auditor': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'finance-critic': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'legal': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'warranty-analyst': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'compliance': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'license-investigator': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'timeline': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'timeline-extractor': '@cf/openai/gpt-oss-120b',
      'timeline-evaluator': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'remedy-rewriter': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'recall-helper': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'default': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'fallback': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    };
    return models[moduleName] || models['default'];
  }
};

// ==========================================
// Gateway URL Construction
// ==========================================

/**
 * Constructs the full AI Gateway URL for a given provider and use case.
 * 
 * @param env - Cloudflare Environment bindings.
 * @param fullModelNameOrProvider - Model slug or provider key.
 * @param useCase - The SDK/protocol context for the endpoint.
 * @returns The absolute URL to the Gateway endpoint.
 */
export async function getAiGatewayUrl(
  env: Env,
  fullModelNameOrProvider: string,
  useCase: GatewayUseCase = 'openai_agents_sdk'
): Promise<string> {
  // If passed a provider directly (legacy support), handle it
  // This logic is adapted from old resolveAiGatewayUrl
  if (['worker-ai', 'workers-ai', 'openai', 'gemini', 'google-ai-studio', 'anthropic'].includes(fullModelNameOrProvider)) {
     const provider = fullModelNameOrProvider;
     const gateway = env.AI.gateway(env.AI_GATEWAY_NAME);

     // Legacy simple routing
     if (provider === 'openai') return await gateway.getUrl('openai');
     if (provider === 'anthropic') return await gateway.getUrl('anthropic');
     if (provider === 'google-ai-studio' || provider === 'gemini') return await gateway.getUrl('google-ai-studio');
     
     // Workers AI fallback — route through /compat with workers-ai/@cf/... model prefix
     return `${await gateway.getUrl('compat')}/chat/completions`;
  }

  // Modern routing based on model slug + useCase
  const gateway = env.AI.gateway(env.AI_GATEWAY_NAME);

  switch (useCase) {
    case 'openai_agents_sdk':
    case 'openai_sdk': {
      const provider = fullModelNameOrProvider.split('/')[0];
      
      if (provider === 'openai') {
        // Native OpenAI -> direct
        return await gateway.getUrl('openai');
      }
      
      // Workers AI (@cf/) via OpenAI SDK -> /compat
      //const gatewayBaseUrl = `${await gateway.getUrl('compat')}/chat/completions`; // Default to workers-ai or generic?
      // Actually gateway.getUrl() usually returns the generic or workers-ai one depending on binding?
      // With AI Gateway bindings, .getUrl(provider) is standard.
      // For @cf models, we often want the 'workers-ai' provider endpoint but utilizing the OpenAI compatibility layer?
      // The original code used `await gateway.getUrl()` for compat.
      const baseUrl = `${await gateway.getUrl('compat')}/chat/completions`; // Default to workers-ai or generic?
      const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      return `${cleanBase}v1`;
    }

    case 'worker_ai':
      // Workers AI models use /compat endpoint; callers must pass model as `workers-ai/@cf/...`
      return `${await gateway.getUrl('compat')}/chat/completions`;

    case 'google_sdk':
      return await gateway.getUrl('google-ai-studio');

    case 'anthropic_sdk':
      return await gateway.getUrl('anthropic');

    default:
      throw new Error(`Unsupported gateway use case: ${useCase}`);
  }
}

// Alias for backward compatibility if needed
export const getAiBaseUrl = getAiGatewayUrl;

/**
 * Normalizes model slugs for compatibility with specific provider endpoints.
 * E.g., strips 'openai/' prefix for native OpenAI calls.
 * 
 * @param modelSlug - The raw model name.
 * @returns The normalized model name.
 */
export function getCompatModelName(modelSlug: string): string {
  if (modelSlug.startsWith('@cf/')) {
    // When routing Workers AI models through /compat, prepend the workers-ai/ provider segment
    return `workers-ai/${modelSlug}`;
  }
  if (modelSlug.startsWith('openai/')) {
    return modelSlug.replace('openai/', '');
  }
  if (modelSlug.startsWith('google-ai-studio/')) {
    return modelSlug.replace('google-ai-studio/', '');
  }  
  if (modelSlug.startsWith('gemini/')) {
    return modelSlug.replace('gemini/', '');
  }    
  if (modelSlug.startsWith('anthropic/')) {
    return modelSlug.replace('anthropic/', '');
  }    
  return modelSlug;
}
