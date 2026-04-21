import type { ISdk } from "iii-sdk";
import type { EmbeddingProvider } from "../types.js";
import { KV } from "../state/schema.js";
import { StateKV } from "../state/kv.js";
import { logger } from "../logger.js";

interface StoredEmbedding {
  imageRef: string;
  vector: number[];
  modelName: string;
  dimensions: number;
  updatedAt: string;
  sessionId?: string;
  observationId?: string;
}

export function registerVisionSearchFunctions(
  sdk: ISdk,
  kv: StateKV,
  imageProvider: EmbeddingProvider | null,
): void {
  sdk.registerFunction(
    "mem::vision-embed",
    async (data: {
      imageRef: string;
      sessionId?: string;
      observationId?: string;
    }) => {
      if (!imageProvider?.embedImage) {
        return { success: false, error: "image embeddings disabled (set AGENTMEMORY_IMAGE_EMBEDDINGS=true)" };
      }
      if (!data?.imageRef || typeof data.imageRef !== "string") {
        return { success: false, error: "imageRef required" };
      }
      try {
        const vec = await imageProvider.embedImage(data.imageRef);
        const stored: StoredEmbedding = {
          imageRef: data.imageRef,
          vector: Array.from(vec),
          modelName: imageProvider.name,
          dimensions: imageProvider.dimensions,
          updatedAt: new Date().toISOString(),
          sessionId: data.sessionId,
          observationId: data.observationId,
        };
        await kv.set(KV.imageEmbeddings, data.imageRef, stored);
        return { success: true, imageRef: data.imageRef, dimensions: stored.dimensions };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("vision-embed failed", { imageRef: data.imageRef, error: msg });
        return { success: false, error: msg };
      }
    },
  );

  sdk.registerFunction(
    "mem::vision-search",
    async (data: {
      queryText?: string;
      queryImageRef?: string;
      queryImageBase64?: string;
      topK?: number;
      sessionId?: string;
    }) => {
      if (!imageProvider?.embedImage) {
        return { success: false, error: "image embeddings disabled (set AGENTMEMORY_IMAGE_EMBEDDINGS=true)" };
      }
      const topK = Math.min(50, Math.max(1, data?.topK ?? 10));

      let queryVec: Float32Array | null = null;
      try {
        if (data?.queryText) {
          queryVec = await imageProvider.embed(data.queryText);
        } else if (data?.queryImageBase64 || data?.queryImageRef) {
          const src = data.queryImageBase64 || (data.queryImageRef as string);
          queryVec = await imageProvider.embedImage(src);
        } else {
          return { success: false, error: "queryText, queryImageRef, or queryImageBase64 required" };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `query embed failed: ${msg}` };
      }

      if (!queryVec) return { success: false, error: "failed to build query vector" };

      const stored = await kv.list<StoredEmbedding>(KV.imageEmbeddings);
      const filtered = data?.sessionId
        ? stored.filter((s) => s.sessionId === data.sessionId)
        : stored;

      const scored = filtered.map((s) => ({
        imageRef: s.imageRef,
        score: cosine(queryVec!, s.vector),
        sessionId: s.sessionId,
        observationId: s.observationId,
        updatedAt: s.updatedAt,
      }));
      scored.sort((a, b) => b.score - a.score);
      return { success: true, results: scored.slice(0, topK), total: scored.length };
    },
  );
}

function cosine(a: Float32Array, b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
