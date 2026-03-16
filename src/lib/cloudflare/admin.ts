/**
 * @module Admin
 * @description Cloudflare Admin API wrappers using CLOUDFLARE_WORKER_ADMIN_TOKEN.
 * Covers Workers, KV, R2, Pages, Queues, etc.
 */

import { fetchCloudflare, getCloudflareConfig } from "./client"

async function fetchAdmin(env: Env, path: string, options: RequestInit & { token?: string, tokenName?: string, ignoreErrors?: number[] } = {}, expectsJson: boolean = true) {
    const { workerAdminToken } = getCloudflareConfig(env);
    const token = options.token || workerAdminToken;
    const tokenName = options.tokenName || "CLOUDFLARE_WORKER_ADMIN_TOKEN";

    return fetchCloudflare(env, path, {
        ...options,
        token,
        tokenName
    }, expectsJson);
}

// --- Workers ---
export const workers = {
    async listScripts(env: Env) {
        return fetchAdmin(env, '/workers/scripts');
    },
    async getScript(env: Env, name: string) {
        const res = await fetchAdmin(env, `/workers/scripts/${name}`, {}, false);
        // @ts-ignore
        const type = res.headers.get("content-type");
        if (type && type.includes("application/json")) {
            // @ts-ignore
            return res.json();
        }
        // @ts-ignore
        return res.text();
    },
    async deployScript(env: Env, name: string, script: string | FormData) {
        const isFormData = script instanceof FormData;
        return fetchAdmin(env, `/workers/scripts/${name}`, {
            method: 'PUT',
            body: isFormData ? script : script,
            headers: isFormData ? {} : { 'Content-Type': 'application/javascript' }
        });
    },
    async deleteScript(env: Env, name: string) {
        return fetchAdmin(env, `/workers/scripts/${name}`, { method: 'DELETE' });
    },
    async getScriptSettings(env: Env, name: string) {
        return fetchAdmin(env, `/workers/scripts/${name}/script-settings`);
    },
    async updateScriptSettings(env: Env, name: string, settings: Record<string, unknown>) {
        return fetchAdmin(env, `/workers/scripts/${name}/script-settings`, {
            method: 'PATCH',
            body: JSON.stringify(settings)
        });
    },
    async search(env: Env, params: URLSearchParams) {
        const query = params.toString() ? `?${params.toString()}` : "";
        return fetchAdmin(env, `/workers/scripts-search${query}`);
    }
}

// --- Builds (CI/CD) ---
export const builds = {
    async list(env: Env, workerId: string) {
        return fetchAdmin(env, `/builds/workers/${workerId}/builds`);
    },
    async getLatest(env: Env) {
        return fetchAdmin(env, `/builds/builds/latest`);
    },
    async get(env: Env, buildId: string) {
        return fetchAdmin(env, `/builds/builds/${buildId}`);
    },
    async getLogs(env: Env, buildId: string) {
        return fetchAdmin(env, `/builds/builds/${buildId}/logs`);
    },
    async upsertRepoConnection(env: Env, connection: Record<string, unknown>) {
        return fetchAdmin(env, `/builds/repos/connections`, {
            method: 'PUT',
            body: JSON.stringify(connection)
        });
    }
}

// --- KV ---
export const kv = {
    // Basic Namespace Ops
    async listNamespaces(env: Env) {
        return fetchAdmin(env, '/storage/kv/namespaces');
    },
    async createNamespace(env: Env, title: string) {
        return fetchAdmin(env, '/storage/kv/namespaces', {
            method: 'POST',
            body: JSON.stringify({ title })
        });
    },

    /**
     * List keys in a namespace.
     */
    async list(env: Env, namespaceId: string, options?: { prefix?: string, limit?: number, cursor?: string }, token?: string) {
        const params = new URLSearchParams();
        if (options?.prefix) params.append("prefix", options.prefix);
        if (options?.limit) params.append("limit", String(options.limit));
        if (options?.cursor) params.append("cursor", options.cursor);

        const query = params.toString() ? `?${params.toString()}` : "";

        return fetchAdmin(env, `/storage/kv/namespaces/${namespaceId}/keys${query}`, {
            token,
            tokenName: token ? "CLOUDFLARE_D1_KV_TOKEN" : undefined
        });
    },

    /**
     * Create or Update a Key-Value pair.
     */
    async create(env: Env, namespaceId: string, key: string, value: string | ReadableStream, _metadata?: Record<string, unknown>, token?: string) {
        return this.putValue(env, namespaceId, key, value, token);
    },

    /**
     * Update a Key-Value pair.
     */
    async update(env: Env, namespaceId: string, key: string, value: string | ReadableStream, token?: string) {
        return this.putValue(env, namespaceId, key, value, token);
    },

    /**
     * Delete a Key-Value pair.
     */
    async delete(env: Env, namespaceId: string, key: string, token?: string) {
        return fetchAdmin(env, `/storage/kv/namespaces/${namespaceId}/values/${key}`, {
            method: 'DELETE',
            token,
            tokenName: token ? "CLOUDFLARE_D1_KV_TOKEN" : undefined
        });
    },

    /**
     * Search for keys matching a term (client-side filtering or prefix).
     */
    async search(env: Env, namespaceId: string, term: string, token?: string) {
        const listRes: unknown[] = await this.list(env, namespaceId, { prefix: term }, token) as unknown[];
        if (Array.isArray(listRes)) {
            return listRes;
        }
        return [];
    },

    /**
     * Safe/Robust Get: combines optimization (direct get) with reliability (list check on failure).
     */
    async robustGet(env: Env, namespaceId: string, key: string, token?: string) {
        try {
            const val = await this.getValue(env, namespaceId, key, token);
            if (val !== null) return val;
            throw new Error("Value returned null (Not Found or Empty)");
        } catch (e) {
            console.warn(`[KV RobustGet] Direct get failed/empty for '${key}'. Verifying via List...`, JSON.stringify(e));

            try {
                const listRes = await this.list(env, namespaceId, { prefix: key }, token) as Array<{ name: string }>;
                const exists = Array.isArray(listRes) && listRes.some((k) => k.name === key);

                if (exists) {
                    return { error: `Key '${key}' exists in namespace but value could not be retrieved directly.` };
                } else {
                    return { error: `Key '${key}' does not exist in namespace.` };
                }
            } catch (listError) {
                const _listError = listError as Error;
                return { error: `Failed to retrieve key and failed to list namespace: ${_listError.message}` };
            }
        }
    },

    /**
     * Safe Get: list keys first to ensure key exists before fetching value.
     */
    async safeGet(env: Env, namespaceId: string, key: string, token?: string) {
        const listRes = await this.list(env, namespaceId, { prefix: key }, token) as Array<{ name: string }>;
        const exists = Array.isArray(listRes) && listRes.some((k) => k.name === key);

        if (!exists) {
            console.warn(`[KV SafeGet] Key '${key}' not found in namespace listing.`);
            return null;
        }

        return this.getValue(env, namespaceId, key, token);
    },

    // Legacy / Direct access methods
    async listKeys(env: Env, namespaceId: string, prefix?: string, token?: string) {
        return this.list(env, namespaceId, { prefix }, token);
    },
    async getValue(env: Env, namespaceId: string, key: string, token?: string) {
        try {
            return await fetchAdmin(env, `/storage/kv/namespaces/${namespaceId}/values/${key}`, {
                token,
                tokenName: token ? "CLOUDFLARE_D1_KV_TOKEN" : undefined,
                ignoreErrors: [404]
            }, false);
        } catch (e) {
            const _e = e as Error;
            if (_e.message?.includes('10009') || _e.message?.includes('404')) {
                return null;
            }
            throw e;
        }
    },
    async putValue(env: Env, namespaceId: string, key: string, value: string | ReadableStream, token?: string) {
        return fetchAdmin(env, `/storage/kv/namespaces/${namespaceId}/values/${key}`, {
            method: 'PUT',
            body: value,
            token,
            tokenName: token ? "CLOUDFLARE_D1_KV_TOKEN" : undefined
        });
    },
    async deleteValue(env: Env, namespaceId: string, key: string, token?: string) {
        return this.delete(env, namespaceId, key, token);
    }
}

// --- R2 ---
export const r2 = {
    async listBuckets(env: Env) {
        return fetchAdmin(env, '/r2/buckets');
    },
    async listObjects(env: Env, bucketName: string, prefix?: string) {
        const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
        return fetchAdmin(env, `/r2/buckets/${bucketName}/objects${query}`);
    },
    async getObject(env: Env, bucketName: string, key: string) {
        return fetchAdmin(env, `/r2/buckets/${bucketName}/objects/${key}`, {}, false);
    },
    async putObject(env: Env, bucketName: string, key: string, data: BodyInit) {
        return fetchAdmin(env, `/r2/buckets/${bucketName}/objects/${key}`, {
            method: 'PUT',
            body: data
        });
    },
    async deleteObject(env: Env, bucketName: string, key: string) {
        return fetchAdmin(env, `/r2/buckets/${bucketName}/objects/${key}`, { method: 'DELETE' });
    }
}

// --- Pages ---
export const pages = {
    async listProjects(env: Env) {
        return fetchAdmin(env, '/pages/projects');
    },
    async getProject(env: Env, name: string) {
        return fetchAdmin(env, `/pages/projects/${name}`);
    },
    async createProject(env: Env, name: string, productionBranch: string) {
        return fetchAdmin(env, '/pages/projects', {
            method: 'POST',
            body: JSON.stringify({
                name,
                production_branch: productionBranch
            })
        });
    }
}

// --- Queues ---
export const queues = {
    async listQueues(env: Env) {
        return fetchAdmin(env, '/queues');
    },
    async createQueue(env: Env, name: string) {
        return fetchAdmin(env, '/queues', {
            method: 'POST',
            body: JSON.stringify({ queue_name: name })
        });
    }
}

// --- Audit Logs ---
export const audit = {
    async getLogs(env: Env, options: {
        limit?: number,
        cursor?: string,
        direction?: 'desc' | 'asc',
        since?: string,
        before?: string
    } = {}) {
        const params = new URLSearchParams();
        if (options.limit) params.append("per_page", String(options.limit));
        if (options.cursor) params.append("cursor", options.cursor);
        if (options.direction) params.append("direction", options.direction);
        if (options.since) params.append("since", options.since);
        if (options.before) params.append("before", options.before);

        if (!options.since) {
            const date = new Date();
            date.setDate(date.getDate() - 7);
            params.append("since", date.toISOString());
        }

        if (!options.before) {
            params.append("before", new Date().toISOString());
        }

        const query = params.toString() ? `?${params.toString()}` : "";
        return fetchAdmin(env, `/logs/audit${query}`);
    }
}

// --- GraphQL ---
export const graphql = {
    async query(env: Env, query: string, variables: Record<string, unknown> = {}) {
        try {
            const { workerAdminToken } = getCloudflareConfig(env);

            const res = await fetchCloudflare(env, '/graphql', {
                method: 'POST',
                body: JSON.stringify({ query, variables }),
                token: workerAdminToken,
                tokenName: "CLOUDFLARE_WORKER_ADMIN_TOKEN"
            }, false);

            if (!res.ok) {
                const text = await res.text();
                return { success: false, errors: [{ message: `HTTP ${res.status}: ${text}` }] };
            }

            const json = await res.json();
            return json;
        } catch (e) {
            const _e = e as Error;
            return { success: false, errors: [{ message: _e.message }] };
        }
    }
}

// --- Generic / Other ---
export async function getAccountDetails(env: Env) {
    return fetchAdmin(env, '');
}
