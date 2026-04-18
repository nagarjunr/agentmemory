const DEFAULT_URL = "http://localhost:3111";
const HEALTH_PROBE_TIMEOUT_MS = 500;
const CALL_TIMEOUT_MS = 15_000;

export interface ProxyHandle {
  mode: "proxy";
  baseUrl: string;
  call: (path: string, init?: RequestInit) => Promise<unknown>;
}

export interface LocalHandle {
  mode: "local";
}

export type Handle = ProxyHandle | LocalHandle;

let cached: Handle | null = null;
let probeInFlight: Promise<Handle> | null = null;

function baseUrl(): string {
  return (process.env["AGENTMEMORY_URL"] || DEFAULT_URL).replace(/\/+$/, "");
}

function authHeader(): Record<string, string> {
  const secret = process.env["AGENTMEMORY_SECRET"];
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/agentmemory/livez`, {
      method: "GET",
      headers: authHeader(),
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveHandle(): Promise<Handle> {
  if (cached) return cached;
  if (probeInFlight) return probeInFlight;
  const url = baseUrl();
  probeInFlight = (async () => {
    const up = await probe(url);
    if (up) {
      const handle: ProxyHandle = {
        mode: "proxy",
        baseUrl: url,
        call: async (path, init) => {
          const res = await fetch(`${url}${path}`, {
            ...init,
            headers: {
              "content-type": "application/json",
              ...authHeader(),
              ...(init?.headers as Record<string, string> | undefined),
            },
            signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          });
          if (!res.ok) {
            throw new Error(
              `${init?.method || "GET"} ${path} -> ${res.status} ${res.statusText}`,
            );
          }
          const text = await res.text();
          return text ? JSON.parse(text) : null;
        },
      };
      cached = handle;
      return handle;
    }
    const local: LocalHandle = { mode: "local" };
    cached = local;
    return local;
  })();
  try {
    return await probeInFlight;
  } finally {
    probeInFlight = null;
  }
}

export function resetHandleForTests(): void {
  cached = null;
  probeInFlight = null;
}
