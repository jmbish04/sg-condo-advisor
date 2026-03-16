import { fetchStrict } from "./apiClient";

export async function getUserPermissionGroups(env: Env) {
    // GET /user/tokens/permission_groups
    return fetchStrict(env, '/user/tokens/permission_groups', {}, 'user_token_admin');
}

export async function getAccountPermissionGroups(env: Env, accountId: string) {
    if (!accountId) throw new Error("Account ID required for permission groups");
    // GET /accounts/:id/tokens/permission_groups
    return fetchStrict(env, `/accounts/${accountId}/tokens/permission_groups`, {}, 'account_token_admin');
}
