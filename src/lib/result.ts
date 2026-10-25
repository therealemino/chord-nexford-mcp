export type ToolOutput = { ok: boolean; agent_guidance?: string; [key: string]: unknown };

export const ok = (data: Record<string, unknown>, agent_guidance: string): ToolOutput => ({
  ok: true,
  ...data,
  agent_guidance,
});

export const fail = (error: string, agent_guidance: string, extra: Record<string, unknown> = {}): ToolOutput => ({
  ok: false,
  error,
  ...extra,
  agent_guidance,
});
