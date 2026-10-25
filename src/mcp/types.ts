import type { DateTime } from "luxon";
import type { z } from "zod";
import type { ToolOutput } from "../lib/result.js";
import type { PaystackClient } from "../services/paystack.js";
import type { Repo } from "../services/types.js";

export interface Deps {
  repo: Repo;
  paystack: PaystackClient;
  now: () => DateTime;
  publicBaseUrl: string;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  handler: (args: z.output<z.ZodObject<S>>, deps: Deps) => Promise<ToolOutput>;
}

/** Identity helper so each tool's handler gets typed arguments from its shape. */
export const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> => def;
