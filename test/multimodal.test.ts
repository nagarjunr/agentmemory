import { describe, it, expect, vi, afterAll } from "vitest";
import { existsSync, rmSync } from "node:fs";

vi.mock("iii-sdk", () => ({
  getContext: () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  }),
}));

vi.mock("../src/functions/search.js", () => ({
  getSearchIndex: () => ({
    add: vi.fn(),
  }),
}));

const mockTriggerVoid = vi.fn();
const mockSdk = { triggerVoid: mockTriggerVoid } as any;

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
    list: async <T>(scope: string): Promise<T[]> => {
      if (!store.has(scope)) return [];
      return Array.from(store.get(scope)!.values()) as T[];
    },
    getStore: () => store,
  };
}

const kv = mockKV() as any;

import { registerObserveFunction } from "../src/functions/observe.js";
import { registerCompressFunction } from "../src/functions/compress.js";
import type { RawObservation, CompressedObservation, MemoryProvider } from "../src/types.js";

const VALID_COMPRESS_XML = `<type>image</type>
<title>Screenshot of Red Dot</title>
<subtitle>Test image observation</subtitle>
<facts><fact>Image shows a single red pixel on white background</fact></facts>
<narrative>A vision model described a screenshot showing a red dot on a white background</narrative>
<concepts><concept>testing</concept><concept>screenshot</concept></concepts>
<files></files>
<importance>5</importance>`;

describe("End-to-End Multimodal Flow", () => {
  let savedImagePath: string | undefined;

  afterAll(() => {
    if (savedImagePath && existsSync(savedImagePath)) {
      rmSync(savedImagePath);
      console.log(`Cleanup: Removed test image at ${savedImagePath}`);
    }
  });

  it("Step 1: Agent image should be successfully saved to hard drive", async () => {
    let observeCallback: any = null;
    const sdkMocker = { ...mockSdk, registerFunction: vi.fn((config, cb) => { if (config.id === "mem::observe") observeCallback = cb; }) };
    registerObserveFunction(sdkMocker, kv);

    const fakeIncomingData = {
      hookType: "post_tool_use",
      sessionId: "test-session",
      timestamp: new Date().toISOString(),
      data: {
        tool_name: "screenshot",
        tool_output: {
          image_data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg=="
        }
      }
    };

    const res = await observeCallback(fakeIncomingData);
    expect(res.observationId).toBeDefined();

    const obsList = await kv.list("mem:obs:test-session");
    expect(obsList.length).toBe(1);

    const raw = obsList[0] as RawObservation;
    expect(raw.modality).toBe("mixed");

    expect(raw.imageData).toBeDefined();
    expect(typeof raw.imageData).toBe("string");
    expect(existsSync(raw.imageData!)).toBe(true);

    savedImagePath = raw.imageData;
  });

  it("Step 2 & 3: mem::compress should call the vision model and store compressed observation in KV", async () => {
    const mockProvider: MemoryProvider = {
      name: "mock-vision",
      compress: async (_systemPrompt, userPrompt) => {
        expect(userPrompt).toContain("TEST_VISION_RESULT: I see a red dot");
        return VALID_COMPRESS_XML;
      },
      summarize: async () => "",
      describeImage: async (_base64, _mimeType, _prompt) => {
        return "TEST_VISION_RESULT: I see a red dot";
      },
    };

    let compressCallback: any = null;
    const sdkMocker = {
      ...mockSdk,
      registerFunction: vi.fn((config, cb) => {
        if (config.id === "mem::compress") compressCallback = cb;
      }),
    };
    registerCompressFunction(sdkMocker, kv, mockProvider);

    expect(compressCallback).not.toBeNull();

    const rawObsList = await kv.list("mem:obs:test-session");
    const raw = rawObsList[0] as RawObservation;

    expect(raw.modality).toBeDefined();
    expect(raw.imageData).toBe(savedImagePath);

    const result = await compressCallback({
      observationId: raw.id,
      sessionId: raw.sessionId,
      raw,
    });

    expect(result.success).toBe(true);
    expect(result.compressed).toBeDefined();

    const compressed = result.compressed as CompressedObservation;
    expect(compressed.imageDescription).toBe("TEST_VISION_RESULT: I see a red dot");
    expect(compressed.imageRef).toBe(savedImagePath);
    expect(compressed.modality).toBe("mixed");
    expect(compressed.title).toBe("Screenshot of Red Dot");
    expect(compressed.narrative).toContain("red dot");

    const stored = await kv.get<CompressedObservation>("mem:obs:test-session", raw.id!);
    expect(stored).not.toBeNull();
    expect(stored!.imageDescription).toBe("TEST_VISION_RESULT: I see a red dot");
    expect(stored!.imageRef).toBe(savedImagePath);
  });
});
