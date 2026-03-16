/**
 * @file backend/src/cloudflare/env-resolver.ts
 * @description Resolves Cloudflare Secrets Store bindings (SecretsStoreSecret → string).
 *
 * Env bindings from wrangler.jsonc Secrets Store have `SecretsStoreSecret` type
 * and must be awaited with `.get()`. This module centralises that logic so that
 * all downstream cloudflare services work with plain strings.
 *
 * Binding name → secret name mapping (from wrangler.jsonc):
 *   AI_GATEWAY_TOKEN              → CLOUDFLARE_AI_GATEWAY_TOKEN
 *   CF_BROWSER_RENDER_TOKEN       → CLOUDFLARE_BROWSER_RENDER_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID         → CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN          → CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_WORKER_ADMIN_TOKEN → CLOUDFLARE_WORKER_ADMIN_TOKEN
 *   CLOUDFLARE_OBSERVABILITY_TOKEN→ CLOUDFLARE_OBSERVABILITY_TOKEN
 *   CLOUDFLARE_AI_SEARCH_TOKEN    → CLOUDFLARE_AI_SEARCH_TOKEN
 */

export interface ResolvedCloudflareEnv {
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_AI_GATEWAY_TOKEN: string;
    CLOUDFLARE_BROWSER_RENDER_TOKEN: string;
    CLOUDFLARE_WORKER_ADMIN_TOKEN: string;
    CLOUDFLARE_OBSERVABILITY_TOKEN: string;
    CLOUDFLARE_AI_SEARCH_TOKEN: string;
    CLOUDFLARE_API_TOKEN: string;
    CLOUDFLARE_ACCOUNT_TOKEN_ADMIN_TOKEN: string;
    CLOUDFLARE_USER_TOKEN_ADMIN: string;
    CLOUDFLARE_ZONE_DNS_ROUTES_TOKEN: string;
    CLOUDFLARE_D1_KV_TOKEN: string;
}

/**
 * Resolves all Cloudflare-related secrets from the Worker Env, returning a
 * plain-string record that can be passed to `getCloudflareConfig()`.
 *
 * Handles both SecretsStoreSecret bindings (need `.get()`) and plain string env vars.
 */
export async function resolveCfEnv(env: Env): Promise<ResolvedCloudflareEnv> {
    const resolve = async (binding: any, fallback = ''): Promise<string> => {
        if (!binding) return fallback;
        if (typeof binding === 'string') return binding;
        // SecretsStoreSecret — async `.get()`
        if (typeof binding?.get === 'function') {
            try { return await binding.get(); } catch { return fallback; }
        }
        return fallback;
    };

    const [
        accountId,
        aiGatewayToken,
        browserRenderToken,
        workerAdminToken,
        observabilityToken,
        aiSearchToken,
        apiToken,
    ] = await Promise.all([
        resolve((env as any).CLOUDFLARE_ACCOUNT_ID),
        // Wrangler binds AI_GATEWAY_TOKEN → CLOUDFLARE_AI_GATEWAY_TOKEN secret
        resolve((env as any).AI_GATEWAY_TOKEN),
        // Wrangler binds CF_BROWSER_RENDER_TOKEN → CLOUDFLARE_BROWSER_RENDER_TOKEN secret
        resolve((env as any).CF_BROWSER_RENDER_TOKEN),
        resolve((env as any).CLOUDFLARE_WORKER_ADMIN_TOKEN),
        resolve((env as any).CLOUDFLARE_OBSERVABILITY_TOKEN),
        resolve((env as any).CLOUDFLARE_AI_SEARCH_TOKEN),
        resolve((env as any).CLOUDFLARE_API_TOKEN),
    ]);

    return {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_AI_GATEWAY_TOKEN: aiGatewayToken,
        CLOUDFLARE_BROWSER_RENDER_TOKEN: browserRenderToken,
        CLOUDFLARE_WORKER_ADMIN_TOKEN: workerAdminToken,
        CLOUDFLARE_OBSERVABILITY_TOKEN: observabilityToken,
        CLOUDFLARE_AI_SEARCH_TOKEN: aiSearchToken,
        CLOUDFLARE_API_TOKEN: apiToken,
        // These share the same admin token in most setups
        CLOUDFLARE_ACCOUNT_TOKEN_ADMIN_TOKEN: apiToken,
        CLOUDFLARE_USER_TOKEN_ADMIN: apiToken,
        CLOUDFLARE_ZONE_DNS_ROUTES_TOKEN: apiToken,
        CLOUDFLARE_D1_KV_TOKEN: workerAdminToken,
    };
}
