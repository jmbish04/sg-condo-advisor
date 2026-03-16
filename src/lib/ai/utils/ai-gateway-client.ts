import { cleanJsonOutput } from '@/ai/utils/sanitizer';
import { zodToJsonSchema } from 'zod-to-json-schema';

export async function createUniversalGatewayClient(env: any, apiKey: string): Promise<any> {
  const gatewayName = env.AI_GATEWAY_NAME || 'core-github-api';
  const aigToken = typeof env.AI_GATEWAY_TOKEN === 'object' && env.AI_GATEWAY_TOKEN?.get
    ? await env.AI_GATEWAY_TOKEN.get()
    : (env.AI_GATEWAY_TOKEN as string);
  const baseURL = env.AI.gateway(gatewayName).getUrl('compat');

  return {
    chat: {
      completions: {
        create: async (body: any) => {
          const res = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey || 'dummy-key'}`,
              'cf-aig-authorization': `Bearer ${aigToken}`,
            },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            throw new Error(`Gateway Error: ${await res.text()}`);
          }
          return res.json();
        },
      },
    },
    models: {
      list: async () => {
        const res = await fetch(`${baseURL}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey || 'dummy-key'}`,
            'cf-aig-authorization': `Bearer ${aigToken}`,
          },
        });
        if (!res.ok) {
          throw new Error(`Gateway Error: ${await res.text()}`);
        }
        return res.json();
      },
    },
  };
}

function normalizeMessages(input: any): Array<{ role: string; content: string }> {
  if (Array.isArray(input)) {
    return input.map((item) => ({
      role: String(item.role || 'user'),
      content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? ''),
    }));
  }

  return [{ role: 'user', content: String(input ?? '') }];
}

function normalizeToolSchema(parameters: unknown) {
  if (parameters && typeof parameters === 'object') {
    return parameters;
  }

  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
}

export async function createUniversalGatewayRunner(env: any, apiKey: string, defaultModel: string) {
  const client = await createUniversalGatewayClient(env, apiKey);

  return {
    run: async (agent: any, input: any) => {
      const config = agent?.config ?? agent ?? {};
      const messages = normalizeMessages(input);
      const model = config.model || defaultModel;
      const request: Record<string, unknown> = {
        model,
        messages: [
          ...(config.instructions ? [{ role: 'system', content: config.instructions }] : []),
          ...messages,
        ],
      };

      if (Array.isArray(config.tools) && config.tools.length > 0) {
        request.tools = config.tools.map((definition: any) => ({
          type: 'function',
          function: {
            name: definition.name,
            description: definition.description || '',
            parameters: normalizeToolSchema(definition.parameters),
          },
        }));
      }

      if (config.outputType) {
        request.response_format = {
          type: 'json_schema',
          json_schema: {
            name: `${config.name || 'agent'}_output`,
            schema: zodToJsonSchema(config.outputType as any, `${config.name || 'agent'}_output`),
            strict: true,
          },
        };
      }

      const response = await client.chat.completions.create(request);
      const message = response.choices?.[0]?.message || {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      for (const toolCall of toolCalls) {
        const toolDef = Array.isArray(config.tools)
          ? config.tools.find((candidate: any) => candidate.name === toolCall.function?.name)
          : undefined;
        if (!toolDef?.execute) {
          continue;
        }

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function?.arguments || '{}');
        } catch {
          parsedArgs = {};
        }

        await toolDef.execute(parsedArgs);
      }

      let finalOutput: unknown = message.content || '';
      if (config.outputType) {
        finalOutput = JSON.parse(cleanJsonOutput(String(message.content || '{}')) || '{}');
      }

      const history = [
        ...messages,
        {
          role: 'assistant',
          content: typeof finalOutput === 'string' ? finalOutput : JSON.stringify(finalOutput),
        },
      ];

      return {
        finalOutput,
        history,
        raw: response,
      };
    },
  };
}

export async function runTextWithModelFallback(
  env: any,
  provider: string,
  model: string,
  instructions: string,
  prompt: string,
): Promise<string> {
  const client = await createUniversalGatewayClient(env, await getApiKeyForProvider(env, provider));
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: prompt },
    ],
  });
  return response.choices?.[0]?.message?.content || '';
}

export async function runStructuredResponseWithModelFallback(
  env: any,
  provider: string,
  model: string,
  instructions: string,
  prompt: string,
): Promise<any> {
  const gatewayName = env.AI_GATEWAY_NAME || 'core-github-api';
  const aigToken = typeof env.AI_GATEWAY_TOKEN === 'object' && env.AI_GATEWAY_TOKEN?.get
    ? await env.AI_GATEWAY_TOKEN.get()
    : (env.AI_GATEWAY_TOKEN as string);

  const apiKey = await getApiKeyForProvider(env, provider);
  const baseURL = env.AI.gateway(gatewayName).getUrl('compat');

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey || 'dummy-key'}`,
      'cf-aig-authorization': `Bearer ${aigToken}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Gateway Error: ${await res.text()}`);
  }
  const json: any = await res.json();
  const result = json.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(cleanJsonOutput(result));
  } catch {
    return { reply: result };
  }
}

async function getApiKeyForProvider(env: any, provider: string): Promise<string> {
  try {
    if (provider.includes('anthropic')) {
      return await env.ANTHROPIC_API_KEY?.get();
    }
    if (provider.includes('gemini') || provider.includes('google')) {
      return (await env.GOOGLE_AI_API_KEY?.get()) || (await env.GEMINI_API_KEY?.get());
    }
    return (await env.OPENAI_API_KEY?.get()) || 'dummy';
  } catch {
    return 'dummy';
  }
}
