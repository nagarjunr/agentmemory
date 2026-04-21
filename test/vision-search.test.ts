import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerVisionSearchFunctions } from "../src/functions/vision-search.js";
import type { EmbeddingProvider } from "../src/types.js";
import { KV } from "../src/state/schema.js";

function mockKV() {
  const store = new Map<string, Map<string, unknown>>();
  return {
    get: async <T>(scope: string, key: string): Promise<T | null> => {
      return (store.get(scope)?.get(key) as T) ?? null;
    },
    set: async <T>(scope: string, key: string, data: T): Promise<T> => {
      if (!store.has(scope)) store.set(scope, new Map());
      store.get(scope)!.set(key, data);
      return data;
    },
    delete: async (scope: string, key: string): Promise<void> => {
      store.get(scope)?.delete(key);
    },
    list: async <T>(scope: string): Promise<T[]> => {
      if (!store.has(scope)) return [];
      return Array.from(store.get(scope)!.values()) as T[];
    },
  };
}

function unit(v: number[]): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return new Float32Array(v.map((x) => x / (norm || 1)));
}

describe("vision-search", () => {
  let visionSearch: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  let visionEmbed: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  let kv: ReturnType<typeof mockKV>;

  const fakeProvider: EmbeddingProvider = {
    name: "fake-clip",
    dimensions: 3,
    embed: async (text: string) => {
      if (text.includes("login")) return unit([1, 0, 0]);
      if (text.includes("dashboard")) return unit([0, 1, 0]);
      return unit([0, 0, 1]);
    },
    embedBatch: async (texts: string[]) => Promise.all(texts.map((t) => fakeProvider.embed(t))),
    embedImage: async (ref: string) => {
      if (ref.endsWith("login.png")) return unit([1, 0.1, 0]);
      if (ref.endsWith("dashboard.png")) return unit([0, 1, 0.1]);
      return unit([0, 0.1, 1]);
    },
  };

  beforeEach(() => {
    kv = mockKV();
    const handlers: Record<string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>> = {};
    const sdk = {
      registerFunction: vi.fn((id: string, cb) => {
        handlers[id] = cb;
      }),
    } as unknown as import("iii-sdk").ISdk;
    registerVisionSearchFunctions(sdk, kv as never, fakeProvider);
    visionSearch = handlers["mem::vision-search"]!;
    visionEmbed = handlers["mem::vision-embed"]!;
  });

  it("embeds and stores image vectors in KV.imageEmbeddings", async () => {
    const res = (await visionEmbed({ imageRef: "/tmp/login.png" })) as { success: boolean; dimensions: number };
    expect(res.success).toBe(true);
    expect(res.dimensions).toBe(3);
    const stored = await kv.list(KV.imageEmbeddings);
    expect(stored.length).toBe(1);
  });

  it("text query ranks the matching image first", async () => {
    await visionEmbed({ imageRef: "/tmp/login.png" });
    await visionEmbed({ imageRef: "/tmp/dashboard.png" });
    await visionEmbed({ imageRef: "/tmp/other.png" });

    const res = (await visionSearch({ queryText: "the login form", topK: 3 })) as {
      success: boolean;
      results: Array<{ imageRef: string; score: number }>;
    };
    expect(res.success).toBe(true);
    expect(res.results[0].imageRef).toBe("/tmp/login.png");
    expect(res.results[0].score).toBeGreaterThan(res.results[1].score);
  });

  it("image-to-image query finds the same image first", async () => {
    await visionEmbed({ imageRef: "/tmp/login.png" });
    await visionEmbed({ imageRef: "/tmp/dashboard.png" });

    const res = (await visionSearch({ queryImageRef: "/tmp/login.png", topK: 2 })) as {
      success: boolean;
      results: Array<{ imageRef: string; score: number }>;
    };
    expect(res.results[0].imageRef).toBe("/tmp/login.png");
    expect(res.results[0].score).toBeGreaterThan(0.9);
  });

  it("sessionId filters out embeddings from other sessions", async () => {
    await visionEmbed({ imageRef: "/tmp/login.png", sessionId: "sess_a" });
    await visionEmbed({ imageRef: "/tmp/dashboard.png", sessionId: "sess_b" });

    const res = (await visionSearch({ queryText: "anything", sessionId: "sess_a", topK: 5 })) as {
      success: boolean;
      results: Array<{ sessionId?: string }>;
    };
    expect(res.results.every((r) => r.sessionId === "sess_a")).toBe(true);
    expect(res.results.length).toBe(1);
  });

  it("returns 503-equivalent error when provider is absent", async () => {
    const handlers: Record<string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>> = {};
    const sdk = {
      registerFunction: vi.fn((id: string, cb) => {
        handlers[id] = cb;
      }),
    } as unknown as import("iii-sdk").ISdk;
    registerVisionSearchFunctions(sdk, kv as never, null);
    const res = (await handlers["mem::vision-search"]!({ queryText: "login" })) as {
      success: boolean;
      error: string;
    };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled/);
  });

  it("rejects missing query", async () => {
    const res = (await visionSearch({})) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/required/);
  });
});
