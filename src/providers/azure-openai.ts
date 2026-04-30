import type { MemoryProvider } from "../types.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function buildFetchOptions(): { fetchFn: typeof fetch; agent?: unknown } {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                   process.env.HTTP_PROXY  || process.env.http_proxy;
  if (!proxyUrl) return { fetchFn: fetch };
  try {
    const tunnel = require("tunnel-agent") as {
      httpsOverHttp: (opts: { proxy: { host: string; port: number } }) => unknown;
    };
    const nodeFetch = require("node-fetch") as typeof fetch;
    const parsed = new URL(proxyUrl);
    const agent = tunnel.httpsOverHttp({
      proxy: { host: parsed.hostname, port: parseInt(parsed.port || "3128") },
    });
    return { fetchFn: nodeFetch, agent };
  } catch {
    return { fetchFn: fetch };
  }
}

export class AzureOpenAIProvider implements MemoryProvider {
  name = "azure-openai";
  private apiKey: string;
  private endpoint: string;
  private deploymentName: string;
  private apiVersion: string;
  private maxTokens: number;

  constructor(
    apiKey: string,
    endpoint: string,
    deploymentName: string,
    maxTokens: number,
    apiVersion = "2024-08-01-preview",
  ) {
    this.apiKey = apiKey;
    this.endpoint = endpoint.replace(/\/$/, "");
    this.deploymentName = deploymentName;
    this.maxTokens = maxTokens;
    this.apiVersion = apiVersion;
  }

  async compress(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.call(systemPrompt, userPrompt);
  }

  async summarize(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.call(systemPrompt, userPrompt);
  }

  private get isFoundry(): boolean {
    return this.endpoint.includes("/anthropic");
  }

  private buildRequest(systemPrompt: string, userPrompt: string): { url: string; body: unknown; headers: Record<string, string> } {
    if (this.isFoundry) {
      return {
        url: `${this.endpoint}/v1/messages`,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: {
          model: this.deploymentName,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
      };
    }
    return {
      url: `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`,
      headers: {
        "Content-Type": "application/json",
        "api-key": this.apiKey,
      },
      body: {
        model: this.deploymentName,
        max_tokens: this.maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
    };
  }

  private extractContent(data: Record<string, unknown>): string | undefined {
    if (this.isFoundry) {
      const content = data.content as Array<{ type: string; text: string }> | undefined;
      return content?.find((b) => b.type === "text")?.text;
    }
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    return choices?.[0]?.message?.content;
  }

  private async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const { url, headers, body } = this.buildRequest(systemPrompt, userPrompt);

    const { fetchFn, agent } = buildFetchOptions();
    const response = await (fetchFn as (url: string, opts: Record<string, unknown>) => Promise<Response>)(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(agent ? { agent } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`azure-openai API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const content = this.extractContent(data);
    if (!content) {
      throw new Error(
        `azure-openai returned unexpected response: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return content;
  }
}
