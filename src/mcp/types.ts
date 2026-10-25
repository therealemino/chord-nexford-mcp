import type { DateTime } from "luxon";
import type { z } from "zod";
import type { ToolOutput } from "../lib/result.js";
import type { NotifyStrategy } from "../config/chord.js";
import type { ChordClient } from "../services/chord.js";
import type { EmailSender } from "../services/email.js";
import type { PaystackClient } from "../services/paystack.js";
import type { Repo } from "../services/types.js";

export interface ChordDeps {
  client: ChordClient;
  workspaceId: string;
  teammateId: string;
  strategy: NotifyStrategy;
}

export interface AlertDeps {
  /** null when Resend isn't configured: alerts are skipped (with a startup warning). */
  email: EmailSender | null;
  to: string[];
  /** e.g. https://chordhq.xyz/threads/{thread_id}; null leaves the link out. */
  threadUrlTemplate: string | null;
  /** Waits before each thread lookup attempt (the agent's turn appears a few seconds after our tool returns). */
  threadLookupDelaysMs: number[];
}

export interface Deps {
  repo: Repo;
  paystack: PaystackClient;
  now: () => DateTime;
  publicBaseUrl: string;
  /** null when proactive Chord messages are switched off. */
  chord: ChordDeps | null;
  alerts: AlertDeps;
  /** Runs work after the HTTP response has been sent; must capture its own errors. */
  runInBackground: (task: () => Promise<void>) => void;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  handler: (args: z.output<z.ZodObject<S>>, deps: Deps) => Promise<ToolOutput>;
}

/** Identity helper so each tool's handler gets typed arguments from its shape. */
export const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> => def;
