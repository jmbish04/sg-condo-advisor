import { fetchStrict } from "../apiClient";

export async function listAccountTokens(env: Env, accountId: string) {
    return fetchStrict(env, `/accounts/${accountId}/tokens`, {}, 'account_token_admin');
}

export async function getAccountToken(env: Env, accountId: string, tokenId: string) {
    return fetchStrict(env, `/accounts/${accountId}/tokens/${tokenId}`, {}, 'account_token_admin');
}

export async function createAccountToken(env: Env, accountId: string, payload: Record<string, unknown>) {
    return fetchStrict(env, `/accounts/${accountId}/tokens`, {
        method: 'POST',
        body: JSON.stringify(payload)
    }, 'account_token_admin');
}

export async function deleteAccountToken(env: Env, accountId: string, tokenId: string) {
    return fetchStrict(env, `/accounts/${accountId}/tokens/${tokenId}`, {
        method: 'DELETE'
    }, 'account_token_admin');
}

export async function validateAccountToken(env: Env, accountId: string) {
    return fetchStrict(env, `/accounts/${accountId}/tokens/verify`, {}, 'account_token_admin');
}
