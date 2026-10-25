import { CHORD_API_BASE } from "../config/chord.js";

/** Raw Chord API access. Every call is real (there is no sandbox). Responses are returned untyped. */
export interface ChordClient {
  listThreads(params: Record<string, string | number | undefined>): Promise<unknown>;
  getThread(id: string): Promise<unknown>;
  createScheduledTask(body: Record<string, unknown>): Promise<unknown>;
  getScheduledTask(id: string): Promise<unknown>;
  takeOver(threadId: string): Promise<unknown>;
  sendMessage(threadId: string, body: Record<string, unknown>): Promise<unknown>;
  handBack(threadId: string): Promise<unknown>;
}

export class ChordError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export function createChordClient(apiKey: string, fetchImpl: typeof fetch = fetch): ChordClient {
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const res = await fetchImpl(`${CHORD_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text
    }
    if (!res.ok) throw new ChordError(`Chord ${method} ${path.split("?")[0]} failed (${res.status})`, res.status, json);
    return json;
  }

  const id = encodeURIComponent;
  return {
    listThreads(params) {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]),
      );
      return call("GET", `/v1/threads?${qs}`);
    },
    getThread: (threadId) => call("GET", `/v1/threads/${id(threadId)}`),
    createScheduledTask: (body) => call("POST", "/v1/scheduled-tasks", body),
    getScheduledTask: (taskId) => call("GET", `/v1/scheduled-tasks/${id(taskId)}`),
    takeOver: (threadId) => call("POST", `/v1/threads/${id(threadId)}/take-over`),
    sendMessage: (threadId, body) => call("POST", `/v1/threads/${id(threadId)}/messages`, body),
    handBack: (threadId) => call("POST", `/v1/threads/${id(threadId)}/hand-back`),
  };
}
