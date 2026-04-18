import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { handleToolCall } from "../src/mcp/standalone.js";
import { resetHandleForTests } from "../src/mcp/rest-proxy.js";
import { InMemoryKV } from "../src/mcp/in-memory-kv.js";

type FetchMock = ReturnType<typeof vi.fn>;

function installFetch(handler: (url: string, init?: RequestInit) => Response): FetchMock {
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) =>
    handler(url.toString(), init),
  );
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

const BASE = "http://localhost:3111";

describe("@agentmemory/mcp standalone — server proxy (issue #159)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetHandleForTests();
    process.env["AGENTMEMORY_URL"] = BASE;
    delete process.env["AGENTMEMORY_SECRET"];
  });

  afterEach(() => {
    resetHandleForTests();
    globalThis.fetch = originalFetch;
    delete process.env["AGENTMEMORY_URL"];
  });

  it("proxies memory_sessions to GET /agentmemory/sessions when server is up", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    installFetch((url, init) => {
      calls.push({ url, method: init?.method || "GET" });
      if (url.endsWith("/agentmemory/livez")) {
        return new Response("ok", { status: 200 });
      }
      if (url.includes("/agentmemory/sessions")) {
        return new Response(
          JSON.stringify({ sessions: [{ id: "sess-1", observations: 69 }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const res = await handleToolCall("memory_sessions", { limit: 5 });
    const body = JSON.parse(res.content[0].text);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe("sess-1");
    expect(calls.find((c) => c.url.includes("/sessions"))).toBeDefined();
  });

  it("proxies memory_smart_search to POST /agentmemory/smart-search", async () => {
    installFetch((url, init) => {
      if (url.endsWith("/agentmemory/livez")) return new Response("ok", { status: 200 });
      if (url.endsWith("/agentmemory/smart-search")) {
        const body = JSON.parse((init?.body as string) || "{}");
        return new Response(
          JSON.stringify({ query: body.query, hits: [{ id: "m1", score: 0.9 }] }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    });
    const res = await handleToolCall("memory_smart_search", { query: "auth bug", limit: 5 });
    const body = JSON.parse(res.content[0].text);
    expect(body.query).toBe("auth bug");
    expect(body.hits[0].id).toBe("m1");
  });

  it("attaches Bearer token when AGENTMEMORY_SECRET is set", async () => {
    process.env["AGENTMEMORY_SECRET"] = "s3cret";
    const seen: string[] = [];
    installFetch((url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.["authorization"];
      if (auth) seen.push(`${url}|${auth}`);
      if (url.endsWith("/agentmemory/livez")) return new Response("ok", { status: 200 });
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    });
    await handleToolCall("memory_sessions", {});
    expect(seen.every((s) => s.endsWith("|Bearer s3cret"))).toBe(true);
    expect(seen.some((s) => s.includes("/agentmemory/livez"))).toBe(true);
  });

  it("falls back to local InMemoryKV when server is unreachable", async () => {
    installFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const localKv = new InMemoryKV(undefined);
    await handleToolCall("memory_save", { content: "local only" }, localKv);
    const recall = await handleToolCall("memory_recall", { query: "local" }, localKv);
    const out = JSON.parse(recall.content[0].text);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("local only");
  });

  it("falls back to local KV for a single request if proxy call throws after probe succeeded", async () => {
    let callCount = 0;
    installFetch((url) => {
      callCount++;
      if (url.endsWith("/agentmemory/livez")) return new Response("ok", { status: 200 });
      return new Response("boom", { status: 500, statusText: "Internal Server Error" });
    });
    const localKv = new InMemoryKV(undefined);
    await handleToolCall("memory_save", { content: "fallback entry" }, localKv);
    const recall = await handleToolCall("memory_recall", { query: "fallback" }, localKv);
    const out = JSON.parse(recall.content[0].text);
    expect(out[0].content).toBe("fallback entry");
    expect(callCount).toBeGreaterThan(1);
  });
});
