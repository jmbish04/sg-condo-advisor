import { fetchStrict } from "./apiClient";

export async function listZones(env: Env, name?: string) {
    const query = name ? `?name=${encodeURIComponent(name)}` : '';
    // GET /zones
    return fetchStrict(env, `/zones${query}`, {}, 'zone_discovery');
}

export async function getZoneIdByName(env: Env, name: string): Promise<string | null> {
    const res = await listZones(env, name);
    // @ts-ignore
    const result = res.result;
    if (result && Array.isArray(result) && result.length > 0) {
        const match = result.find((z: { name: string; id: string }) => z.name === name);
        return match ? match.id : null;
    }
    return null;
}
