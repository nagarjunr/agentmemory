#!/usr/bin/env node

import { InMemoryKV } from "./in-memory-kv.js";
import { createStdioTransport } from "./transport.js";
import { getVisibleTools } from "./tools-registry.js";
import { getStandalonePersistPath } from "../config.js";
import { VERSION } from "../version.js";
import { generateId } from "../state/schema.js";
import { resolveHandle, type Handle, type ProxyHandle } from "./rest-proxy.js";

const IMPLEMENTED_TOOLS = new Set([
  "memory_save",
  "memory_recall",
  "memory_smart_search",
  "memory_sessions",
  "memory_export",
  "memory_audit",
  "memory_governance_delete",
]);

const SERVER_INFO = {
  name: "agentmemory",
  version: VERSION,
  protocolVersion: "2024-11-05",
};

const kv = new InMemoryKV(getStandalonePersistPath());
let modeAnnounced = false;

function announceMode(handle: Handle): void {
  if (modeAnnounced) return;
  modeAnnounced = true;
  if (handle.mode === "proxy") {
    process.stderr.write(
      `[@agentmemory/mcp] proxying to agentmemory server at ${handle.baseUrl}\n`,
    );
  } else {
    process.stderr.write(
      `[@agentmemory/mcp] no server reachable at ${process.env["AGENTMEMORY_URL"] || "http://localhost:3111"}; falling back to local InMemoryKV\n`,
    );
  }
}

function normalizeList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
function parseLimit(raw: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof raw !== "number" && typeof raw !== "string") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function textResponse(payload: unknown, pretty = false): {
  content: Array<{ type: string; text: string }>;
} {
  return {
    content: [
      { type: "text", text: JSON.stringify(payload, null, pretty ? 2 : 0) },
    ],
  };
}

async function handleProxy(
  toolName: string,
  args: Record<string, unknown>,
  handle: ProxyHandle,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (toolName) {
    case "memory_save": {
      const content = args["content"];
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("content is required");
      }
      const payload = {
        content,
        type: (args["type"] as string) || "fact",
        concepts: normalizeList(args["concepts"]),
        files: normalizeList(args["files"]),
      };
      const result = await handle.call("/agentmemory/remember", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return textResponse(result);
    }

    case "memory_recall":
    case "memory_smart_search": {
      const query = args["query"];
      if (typeof query !== "string" || !query.trim()) {
        throw new Error("query is required");
      }
      const limit = parseLimit(args["limit"]);
      const result = await handle.call("/agentmemory/smart-search", {
        method: "POST",
        body: JSON.stringify({ query: query.trim(), limit }),
      });
      return textResponse(result, true);
    }

    case "memory_sessions": {
      const limit = parseLimit(args["limit"], 20);
      const result = await handle.call(
        `/agentmemory/sessions?limit=${limit}`,
        { method: "GET" },
      );
      return textResponse(result, true);
    }

    case "memory_governance_delete": {
      const ids = normalizeList(args["memoryIds"]);
      if (ids.length === 0) throw new Error("memoryIds is required");
      const result = await handle.call("/agentmemory/governance/memories", {
        method: "POST",
        body: JSON.stringify({
          memoryIds: ids,
          reason: (args["reason"] as string) || "plugin skill request",
        }),
      });
      return textResponse(result);
    }

    case "memory_export": {
      const result = await handle.call("/agentmemory/export", { method: "GET" });
      return textResponse(result, true);
    }

    case "memory_audit": {
      const limit = parseLimit(args["limit"], 50);
      const result = await handle.call(
        `/agentmemory/audit?limit=${limit}`,
        { method: "GET" },
      );
      return textResponse(result, true);
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function handleLocal(
  toolName: string,
  args: Record<string, unknown>,
  kvInstance: InMemoryKV,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (toolName) {
    case "memory_save": {
      const rawContent = args["content"];
      if (typeof rawContent !== "string" || !rawContent.trim()) {
        throw new Error("content is required");
      }
      const content = rawContent;
      const id = generateId("mem");
      const isoNow = new Date().toISOString();
      await kvInstance.set("mem:memories", id, {
        id,
        type: (args["type"] as string) || "fact",
        title: content.slice(0, 80),
        content,
        concepts: normalizeList(args["concepts"]),
        files: normalizeList(args["files"]),
        createdAt: isoNow,
        updatedAt: isoNow,
        strength: 7,
        version: 1,
        isLatest: true,
        sessionIds: [],
      });
      kvInstance.persist();
      return textResponse({ saved: id });
    }

    case "memory_recall":
    case "memory_smart_search": {
      const rawQuery = args["query"];
      if (typeof rawQuery !== "string" || !rawQuery.trim()) {
        throw new Error("query is required");
      }
      const query = rawQuery.trim().toLowerCase();
      const limit = parseLimit(args["limit"]);
      const all =
        await kvInstance.list<Record<string, unknown>>("mem:memories");
      const results = all
        .filter((m) => {
          const text = [
            typeof m["title"] === "string" ? m["title"] : "",
            typeof m["content"] === "string" ? m["content"] : "",
            Array.isArray(m["files"]) ? m["files"].join(" ") : "",
            Array.isArray(m["concepts"]) ? m["concepts"].join(" ") : "",
            Array.isArray(m["sessionIds"]) ? m["sessionIds"].join(" ") : "",
            typeof m["id"] === "string" ? m["id"] : "",
          ]
            .join(" ")
            .toLowerCase();
          return query.split(/\s+/).every((word) => text.includes(word));
        })
        .slice(0, limit);
      return textResponse(results, true);
    }

    case "memory_sessions": {
      const sessions =
        await kvInstance.list<Record<string, unknown>>("mem:sessions");
      const limit = parseLimit(args["limit"], 20);
      return textResponse({ sessions: sessions.slice(0, limit) }, true);
    }

    case "memory_governance_delete": {
      const ids = normalizeList(args["memoryIds"]);
      if (ids.length === 0) throw new Error("memoryIds is required");
      let deleted = 0;
      for (const id of ids) {
        const existing = await kvInstance.get("mem:memories", id);
        if (existing) {
          await kvInstance.delete("mem:memories", id);
          deleted++;
        }
      }
      kvInstance.persist();
      return textResponse({
        deleted,
        requested: ids.length,
        reason: (args["reason"] as string) || "plugin skill request",
      });
    }

    case "memory_export": {
      const memories = await kvInstance.list("mem:memories");
      const sessions = await kvInstance.list("mem:sessions");
      return textResponse({ version: VERSION, memories, sessions }, true);
    }

    case "memory_audit": {
      const entries = await kvInstance.list("mem:audit");
      const limit = parseLimit(args["limit"], 50);
      return textResponse(
        (entries as Array<Record<string, unknown>>).slice(0, limit),
        true,
      );
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  kvInstance: InMemoryKV = kv,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const handle = await resolveHandle();
  announceMode(handle);
  if (handle.mode === "proxy") {
    try {
      return await handleProxy(toolName, args, handle);
    } catch (err) {
      process.stderr.write(
        `[@agentmemory/mcp] proxy call failed for ${toolName}: ${err instanceof Error ? err.message : String(err)}; falling back to local KV for this request\n`,
      );
    }
  }
  return handleLocal(toolName, args, kvInstance);
}

const transport = createStdioTransport(async (method, params) => {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: SERVER_INFO.protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: SERVER_INFO.name,
          version: SERVER_INFO.version,
        },
      };

    case "notifications/initialized":
      return {};

    case "tools/list":
      return {
        tools: getVisibleTools().filter((t) => IMPLEMENTED_TOOLS.has(t.name)),
      };

    case "tools/call": {
      const toolName = params.name as string;
      const toolArgs = (params.arguments as Record<string, unknown>) || {};
      try {
        return await handleToolCall(toolName, toolArgs);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
});

process.stderr.write(
  `[@agentmemory/mcp] Standalone MCP server v${SERVER_INFO.version} starting...\n`,
);
transport.start();

process.on("SIGINT", () => {
  kv.persist();
  process.exit(0);
});
process.on("SIGTERM", () => {
  kv.persist();
  process.exit(0);
});
