// Removed Config import to make module isomorphic
// import { Config, loadConfig } from "../config"

export function getCloudflareConfig(configOrenv: any) {
    // If configOrEnv is not passed, and we are in Node, we might want to usage process.env
    // But we cannot safely call loadConfig() here.
    // Callers MUST pass the config or env object.

    // Support both snake_case (Config object) and UPPER_CASE (Env/Process) keys
    const get = (key: string, envKey: string) => {
        return configOrenv[key] || configOrenv[envKey] || (typeof process !== 'undefined' ? process.env[envKey] : undefined);
    }

    const accountId = get('cloudflare_account_id', 'CLOUDFLARE_ACCOUNT_ID');
    const apiToken = undefined; // disabled generic token

    // ... map remaining fields ...
    const d1Id = get('cloudflare_d1_database_id', 'CLOUDFLARE_D1_DATABASE_ID');
    const vectorizeIndex =
        get('cloudflare_vectorize_index', 'CLOUDFLARE_VECTORIZE_INDEX_NAME') ||
        get('cloudflare_vectorize_index', 'CLOUDFLARE_VECTORIZE_INDEX'); // Config has snake case, env has various

    const embeddingModel = get('cloudflare_vectorize_embedding_model', 'CLOUDFLARE_VECTORIZE_EMBEDDING_MODEL');
    const d1KvToken = get('cloudflare_d1_kv_token', 'CLOUDFLARE_D1_KV_TOKEN');
    const kvNamespaceId =
        get('cloudflare_kv_namespace_id', 'CLOUDFLARE_KV_NAMESPACE_ID') ||
        get('cloudflare_kv_namespace_id', 'CLOUDFLARE_KV_NAMESPACE');

    const kvNamespaceAgentMemoryId =
        get('cloudflare_agent_memory_kv_namespace_id', 'CLOUDFLARE_AGENT_MEMORY_KV_NAMESPACE_ID') ||
        get('cloudflare_agent_memory_kv_namespace_id', 'CLOUDFLARE_KV_NAMESPACE_AGENT_MEMORY');

    const aiGatewayToken = get('cloudflare_ai_gateway_token', 'CLOUDFLARE_AI_GATEWAY_TOKEN');
    const aiSearchToken = get('cloudflare_ai_search_token', 'CLOUDFLARE_AI_SEARCH_TOKEN');
    const browserRenderToken = get('cloudflare_browser_render_token', 'CLOUDFLARE_BROWSER_RENDER_TOKEN');
    const workerAdminToken = get('cloudflare_worker_admin_token', 'CLOUDFLARE_WORKER_ADMIN_TOKEN');

    const accountTokenAdminToken = get('cloudflare_account_token_admin_token', 'CLOUDFLARE_ACCOUNT_TOKEN_ADMIN_TOKEN');
    const userTokenAdmin = get('cloudflare_user_token_admin', 'CLOUDFLARE_USER_TOKEN_ADMIN');
    const zoneDnsRoutesToken = get('cloudflare_zone_dns_routes_token', 'CLOUDFLARE_ZONE_DNS_ROUTES_TOKEN');
    const workerUrl = get('cloudflare_worker_url', 'CLOUDFLARE_WORKER_URL');
    const askWorkerApiKey = get('ask_worker_api_key', 'ASK_WORKER_API_KEY');

    return {
        accountId,
        apiToken,
        d1Id,
        vectorizeIndex,
        embeddingModel,
        d1KvToken,
        kvNamespaceId,
        kvNamespaceAgentMemoryId,
        aiGatewayToken,
        aiSearchToken,
        browserRenderToken,
        workerAdminToken,
        accountTokenAdminToken,
        userTokenAdmin,
        zoneDnsRoutesToken,
        ghTemplatesIndex: get('cloudflare_vectorize_gh_templates_index_name', 'CLOUDFLARE_VECTORIZE_GH_TEMPLATES_INDEX_NAME'),
        vectorizeEmbeddingModel: embeddingModel,
        workerUrl,
        askWorkerApiKey
    }
}


export interface CloudflareFetchOptions extends RequestInit {
    token?: string;
    tokenName?: string;
    ignoreErrors?: number[];
    silent?: boolean;
}

export async function fetchCloudflare(
    env: Env,
    path: string,
    options: CloudflareFetchOptions = {},
    expectsJson: boolean = true
) {
    const config = getCloudflareConfig(env);
    const {
        accountId,
        aiGatewayToken,
        browserRenderToken,
        d1KvToken,
        workerAdminToken,
        accountTokenAdminToken,
        userTokenAdmin,
        zoneDnsRoutesToken
    } = config;

    // Use explicit token if provided, otherwise infer from path
    let token = (options as any).token;
    let tokenName = (options as any).tokenName;

    if (!token) {
        if (path.includes('/browser-rendering')) {
            token = browserRenderToken;
            tokenName = "CLOUDFLARE_BROWSER_RENDER_TOKEN";
        } else if (path.includes('/d1/') || path.includes('/storage/kv')) {
            token = d1KvToken;
            tokenName = "CLOUDFLARE_D1_KV_TOKEN";
        } else if (path.includes('/ai/run') || path.includes('/vectorize')) {
            token = aiGatewayToken;
            tokenName = "CLOUDFLARE_AI_GATEWAY_TOKEN";
        } else if (path.includes('/user/tokens')) {
            token = userTokenAdmin;
            tokenName = "CLOUDFLARE_USER_TOKEN_ADMIN";
        } else if (path.includes('/tokens')) {
            // Matches /accounts/:id/tokens (Account Tokens) since user tokens are handled above
            token = accountTokenAdminToken;
            tokenName = "CLOUDFLARE_ACCOUNT_TOKEN_ADMIN_TOKEN";
        } else if (path.includes('/zones')) {
            token = zoneDnsRoutesToken;
            tokenName = "CLOUDFLARE_ZONE_DNS_ROUTES_TOKEN";
        } else if (
            path.includes('/workers/') ||
            path.includes('/pages') ||
            path.includes('/queues') ||
            path.includes('/r2/') ||
            path.includes('/builds')
        ) {
            token = workerAdminToken;
            tokenName = "CLOUDFLARE_WORKER_ADMIN_TOKEN";
        }
    }

    // Default to UNKNOWN if we still haven't named it (e.g. explicitly passed but unnamed)
    tokenName = tokenName || "UNKNOWN_TOKEN";

    if (!accountId || !token) {
        throw new Error(
            `Missing CLOUDFLARE_ACCOUNT_ID or Service-Specific Token for path '${path}'. (generic CLOUDFLARE_{PERMISSION_SCOPED}API_TOKEN is disabled)`
        )
    }

    let url = (env as any)?.CLOUDFLARE_API_BASE_URL
        ? `${(env as any).CLOUDFLARE_API_BASE_URL}/v4`
        : `https://api.cloudflare.com/client/v4`

    // If path is global or fully qualified with account/user/zone, append directly.
    // Otherwise, assume it's an account-scoped resource that needs the prefix.
    if (
        path.startsWith('/accounts') ||
        path.startsWith('/user') ||
        path.startsWith('/zones') ||
        path.startsWith('/memberships') ||
        path.startsWith('/graphql')
    ) {
        url += path
    } else {
        url += `/accounts/${accountId}${path}`
    }

    // Removed colorette to avoid 'tty' dependency in Worker
    const maskedToken = token ? `${token.substring(0, 4)}...${token.substring(token.length - 4)}` : "MISSING"

    if (!options.silent) {
        // Simple logging without colors
        console.log(`\n[CF API] Request: ${options.method || 'GET'} ${url}`)
        console.log(`[CF API] Auth: Using ${tokenName} (${maskedToken})`)
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers as Record<string, string>),
    }

    // Detect FormData (simple check)
    // @ts-ignore
    if (options.body instanceof FormData || (options.body && options.body.constructor && options.body.constructor.name === 'FormData')) {
        delete headers["Content-Type"];
    }

    const res = await fetch(url, {
        ...options,
        headers,
    })

    if (!options.silent) {
        console.log(`[CF API] Response: ${res.status} ${res.statusText}`)
    }

    if (!res.ok) {
        const errorText = await res.text()
        const shouldLog = !options.ignoreErrors?.includes(res.status);

        if (shouldLog && !options.silent) {
            console.error(`[CF API] Error Body: ${errorText}`)
        } else if (!options.silent) {
            console.log(`[CF API] (Ignored Error ${res.status}): ${errorText}`)
        }

        let errorMsg = `Cloudflare API Error: ${res.status} ${res.statusText} - ${errorText}`;
        if (res.status === 401 || res.status === 403) {
            errorMsg += ` (Used Token: ${tokenName})`;
            console.warn(`[Auth Error] 401/403 with Token: ${tokenName} (Masked: ${maskedToken})`);
        }

        throw new Error(errorMsg)
    }

    if (!expectsJson) {
        return res
    }

    const json = await res.json() as any
    return json.result
}
