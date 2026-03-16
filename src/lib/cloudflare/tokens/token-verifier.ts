
import { fetchCloudflare } from "@/cloudflare/client"

export interface TokenStatus {
    valid: boolean;
    id?: string;
    status?: "active" | "disabled" | "expired";
    message?: string;
    canUseWorkerAI?: boolean;
}

export async function verifyToken(token: string, accountId?: string): Promise<TokenStatus> {
    try {
        // 1. Dual-Mode Verification (Account First -> User Fallback)
        let basicInfo: any = {};
        let verificationMethod = "none";

        // A. Try Account Token Verification (Preferred for this app)
        if (accountId) {
            try {
                const accountVerifyRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`, {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    }
                });

                if (accountVerifyRes.ok) {
                    const json = await accountVerifyRes.json() as any;
                    if (json.success) {
                        basicInfo = json.result;
                        verificationMethod = "account";
                    }
                }
            } catch (e) {
                // Ignore network errors, proceed to fallback
            }
        }

        // B. Fallback to User Token Verification
        if (!basicInfo.id) {
            try {
                const userVerifyRes = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    }
                });

                if (userVerifyRes.ok) {
                    const json = await userVerifyRes.json() as any;
                    if (json.success) {
                        basicInfo = json.result;
                        verificationMethod = "user";
                    }
                }
            } catch (e) {
                // Ignore
            }
        }

        // C. Result Handling
        if (!basicInfo.id) {
            // console.warn("Token verification failed for both Account and User endpoints. Proceeding to capability check.");
            basicInfo = { status: 'unknown', id: 'unknown' };
        }

        const tokenId = basicInfo.id;
        const status = basicInfo.status || 'active';

        if (status !== "active" && status !== 'unknown') {
            return { valid: true, id: tokenId, status, message: "Token is not active" };
        }

        // 2. Check Worker AI Capability
        // We try a lightweight operation: Listing basic info or assuming true if we can't test
        let canUseWorkerAI = false;

        if (accountId) {
            try {
                // Try listing models (read-only check)
                const modelsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?per_page=1`, {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    }
                });

                if (modelsRes.ok) {
                    canUseWorkerAI = true;
                } else {
                    // If listing fails, maybe it only has run permission?
                    // We can't easily test run without cost/side-effects.
                    // For now, if verify endpoint failed AND models endpoint failed, we assume invalid.
                    if (basicInfo.status === 'unknown') {
                        return { valid: false, message: "Verification and AI capability check failed" };
                    }
                }
            } catch (e) {
                if (basicInfo.status === 'unknown') {
                    return { valid: false, message: "Verification failed and AI check threw error" };
                }
            }
        } else {
            // Without account ID, we can't verify capabilities.
            // If basic verification failed, we have to assume invalid.
            if (basicInfo.status === 'unknown') {
                // SPECIAL CASE: If it's an AI Gateway token, it might strictly be for Gateway.
                // But this verifier is for General API tokens.
                // We'll relax it: if it looks like an API token (standard format), we might just allow it with caution.
                // But safest is to require at least one check to pass.
                return { valid: false, message: "Cannot verify token without Account ID or `user/tokens/verify` permission" };
            }
            canUseWorkerAI = true; // Assume yes if active and we can't test otherwise? Or false?
        }

        return {
            valid: true,
            id: tokenId,
            status,
            canUseWorkerAI
        };

    } catch (error) {
        return { valid: false, message: String(error) };
    }
}

export async function findBestAiToken(env: Record<string, string | undefined>, accountId?: string): Promise<string | null> {
    // Candidates: Keys ending in _TOKEN, prioritizing those with 'AI' in name
    const candidates = Object.keys(env).filter(k => k.endsWith('_TOKEN'));

    // Priority sort: AI_GATEWAY ?? -> AI -> ...
    const sorted = candidates.sort((a, b) => {
        const aScore = (a.includes('AI_GATEWAY') ? 3 : 0) + (a.includes('AI') ? 2 : 0);
        const bScore = (b.includes('AI_GATEWAY') ? 3 : 0) + (b.includes('AI') ? 2 : 0);
        return bScore - aScore;
    });

    for (const key of sorted) {
        const token = env[key];
        if (!token) continue;

        const result = await verifyToken(token, accountId);
        if (result.valid && result.status === 'active' && result.canUseWorkerAI) {
            console.log(`[Token Discovery] Found working AI token: ${key}`);
            return token;
        }
    }

    return null;
}
