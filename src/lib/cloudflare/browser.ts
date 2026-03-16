
import { z } from 'zod';
import { getCloudflareConfig } from './client';
// //import { Env } from "../types";


// --- Type Definitions for Cloudflare Browser Rendering API ---

export type ContentRequest = {
    url?: string;
    html?: string;
    rejectResourceTypes?: string[];
    rejectRequestPattern?: string[];
    allowResourceTypes?: string[];
    allowRequestPattern?: string[];
    userAgent?: string;
};

export type ScreenshotRequest = {
    url?: string;
    html?: string;
    cookies?: Array<{
        name: string;
        value: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
    }>;
    authenticate?: {
        username: string;
        password: string;
    };
    setExtraHTTPHeaders?: Record<string, string>;
    screenshotOptions?: {
        fullPage?: boolean;
        omitBackground?: boolean;
        type?: 'jpeg' | 'png' | 'webp';
        quality?: number; // 0-100 for jpeg/webp
        clip?: { x: number; y: number; width: number; height: number };
        captureBeyondViewport?: boolean;
        selector?: string;
    };
    viewport?: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    };
    gotoOptions?: {
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
        timeout?: number;
    };
    userAgent?: string;
};

export type PDFRequest = {
    url?: string;
    html?: string;
    pdfOptions?: {
        format?: 'a0' | 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'ledger' | 'legal' | 'letter' | 'tabloid';
        landscape?: boolean;
        printBackground?: boolean;
        headerTemplate?: string;
        footerTemplate?: string;
        displayHeaderFooter?: boolean;
        scale?: number;
        margin?: { top?: string; bottom?: string; left?: string; right?: string };
    };
    userAgent?: string;
};

export type SnapshotRequest = ContentRequest & ScreenshotRequest & {
    setJavaScriptEnabled?: boolean;
};

export type ScrapeElement = {
    selector: string;
};

export type ScrapeRequest = {
    url?: string;
    elements: ScrapeElement[];
    userAgent?: string;
};

export type JsonRequest = {
    url?: string;
    html?: string;
    prompt?: string;
    response_format?: {
        type: 'json_schema';
        schema: Record<string, any>;
    };
    custom_ai?: {
        model: string;
        authorization: string;
    }[];
    userAgent?: string;
};

export type LinksRequest = {
    url?: string;
    html?: string;
    visibleLinksOnly?: boolean;
    excludeExternalLinks?: boolean;
    userAgent?: string;
    gotoOptions?: {
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
        timeout?: number;
    };
};

export type MarkdownRequest = {
    url?: string;
    html?: string;
    rejectRequestPattern?: string[];
    userAgent?: string;
    gotoOptions?: {
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
        timeout?: number;
    };
};

// --- Service Class ---

export class BrowserService {
    private env: any;
    private accountId: string | undefined; // Changed to allow undefined in strict mode initially, logic handles check
    private token: string | undefined;
    private baseUrl: string;

    constructor(env: Env) {
        this.env = env || {};
        const config = getCloudflareConfig(this.env);

        this.accountId = this.env.CLOUDFLARE_ACCOUNT_ID || config.accountId;
        // Support specific token first, then fallback to API token if user provided it (though discouraged)
        this.token = this.env.CLOUDFLARE_BROWSER_RENDER_TOKEN || config.browserRenderToken;
        this.baseUrl = this.env.CLOUDFLARE_API_BASE_URL || "https://api.cloudflare.com/client/v4/accounts";
    }

    private async callCloudflare(endpoint: string, requestBody: object, expectsJson: boolean = true) {
        if (!this.accountId || !this.token) {
            console.warn("Debug: Missing Credentials. Env Keys:", Object.keys(this.env));
            console.warn("Debug: Config Env Keys:", Object.keys(process.env));
            throw new Error(`Missing Cloudflare credentials (Account ID or Browser Token). Account: ${this.accountId ? 'OK' : 'MISSING'}, Token: ${this.token ? 'OK' : 'MISSING'}`);
        }

        const apiUrl = `${this.baseUrl}/${this.accountId}/browser-rendering${endpoint}`;

        const fetchOptions: RequestInit = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        };

        const cfResponse = await fetch(apiUrl, fetchOptions);

        if (!cfResponse.ok) {
            const errorText = await cfResponse.text();
            throw new Error(`Cloudflare API Error for ${endpoint}: ${cfResponse.status} - ${errorText}`);
        }

        if (expectsJson) {
            return await cfResponse.json();
        } else {
            return cfResponse;
        }
    }

    async getContent(body: ContentRequest): Promise<any> {
        return this.callCloudflare('/content', body);
    }

    async getScreenshot(body: ScreenshotRequest): Promise<any> {
        return this.callCloudflare('/screenshot', body, false);
    }

    async getScreenshotBase64(url: string): Promise<string> {
        const res = await this.getScreenshot({ url, screenshotOptions: { type: 'jpeg', quality: 50, fullPage: false } }) as Response;
        // @ts-ignore
        const buffer = await res.arrayBuffer();
        // @ts-ignore
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        return `data:image/jpeg;base64,${base64}`;
    }

    async getPdf(body: PDFRequest): Promise<any> {
        return this.callCloudflare('/pdf', body, false);
    }

    async getSnapshot(body: SnapshotRequest): Promise<any> {
        return this.callCloudflare('/snapshot', body);
    }

    async scrape(body: ScrapeRequest): Promise<any> {
        return this.callCloudflare('/scrape', body);
    }

    async getJson(body: JsonRequest): Promise<any> {
        return this.callCloudflare('/json', body);
    }

    async getLinks(body: LinksRequest): Promise<any> {
        return this.callCloudflare('/links', body);
    }

    async getMarkdown(body: MarkdownRequest): Promise<any> {
        return this.callCloudflare('/markdown', body);
    }
}

export const getBrowserTools = (env: any) => {
    return [
        {
            name: "browser_screenshot",
            description: "Take a screenshot of a webpage. useful for verifying UI.",
            parameters: z.object({
                url: z.string().describe("URL to screenshot")
            }),
            execute: async (args: { url: string }) => {
                const service = new BrowserService(env);
                return await service.getScreenshotBase64(args.url);
            }
        },
        {
            name: "browser_scrape",
            description: "Scrape text content from a webpage.",
            parameters: z.object({
                url: z.string().describe("URL to scrape")
            }),
            execute: async (args: { url: string }) => {
                const service = new BrowserService(env);
                return await service.scrape({
                    url: args.url,
                    elements: [{ selector: "body" }]
                });
            }
        }
    ];
};
