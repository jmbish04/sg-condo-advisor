import { fetchStrict } from "../apiClient";

export async function listUserTokens(env: Env) {
    return fetchStrict(env, '/user/tokens', {}, 'user_token_admin');
}

export async function getUserToken(env: Env, tokenId: string) {
    return fetchStrict(env, `/user/tokens/${tokenId}`, {}, 'user_token_admin');
}

export async function createUserToken(env: Env, payload: Record<string, unknown>) {
    return fetchStrict(env, '/user/tokens', {
        method: 'POST',
        body: JSON.stringify(payload)
    }, 'user_token_admin');
}

export async function deleteUserToken(env: Env, tokenId: string) {
    return fetchStrict(env, `/user/tokens/${tokenId}`, {
        method: 'DELETE'
    }, 'user_token_admin');
}

export async function verifyUserToken(env: Env) {
    return fetchStrict(env, '/user/tokens/verify', {}, 'user_token_admin');
}
