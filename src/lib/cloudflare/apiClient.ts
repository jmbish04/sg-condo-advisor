import { fetchCloudflare, getCloudflareConfig } from "./client";

type EndpointFamily =
    | 'zone_discovery'
    | 'user_token_admin'
    | 'account_token_admin'
    | 'worker_admin';

export async function fetchStrict(env: Env, path: string, options: RequestInit = {}, family: EndpointFamily) {
    const config = getCloudflareConfig(env);
    let token: string | undefined;

    switch (family) {
        case 'zone_discovery':
            token = config.zoneDnsRoutesToken;
            break;
        case 'user_token_admin':
            token = config.userTokenAdmin;
            break;
        case 'account_token_admin':
            token = config.accountTokenAdminToken;
            break;
        case 'worker_admin':
            token = config.workerAdminToken;
            break;
    }

    if (!token) {
        console.warn(`Missing token for family: ${family}`);
    }

    return fetchCloudflare(env, path, {
        ...options,
        token,
    } as any, true);
}

