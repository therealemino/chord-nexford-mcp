import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_URL = "https://api.paystack.co";

export interface InitializeInput {
  email: string;
  amountKobo: number;
  currency: "NGN";
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface VerifiedTransaction {
  reference: string;
  /** Paystack transaction status: success, failed, abandoned, ongoing, pending, processing, queued, reversed */
  status: string;
  amount: number;
  currency: string;
  paid_at: string | null;
}

export interface PaystackClient {
  initialize(input: InitializeInput): Promise<{ authorization_url: string; reference: string }>;
  verify(reference: string): Promise<VerifiedTransaction>;
}

export class PaystackError extends Error {}

export function createPaystackClient(secretKey: string, fetchImpl: typeof fetch = fetch): PaystackClient {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (!res.ok || !json?.status || json.data === undefined) {
      throw new PaystackError(`Paystack ${method} ${path.split("/").slice(0, 3).join("/")} failed (${res.status}): ${json?.message ?? "no body"}`);
    }
    return json.data;
  }

  return {
    async initialize(input) {
      const data = await call<{ authorization_url: string; reference: string }>("POST", "/transaction/initialize", {
        email: input.email,
        amount: input.amountKobo,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      });
      return { authorization_url: data.authorization_url, reference: data.reference };
    },
    async verify(reference) {
      const data = await call<VerifiedTransaction>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
      return {
        reference: data.reference,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        paid_at: data.paid_at ?? null,
      };
    },
  };
}

/** x-paystack-signature is the hex HMAC-SHA512 of the raw body, keyed with the secret key. */
export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined, secretKey: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  const given = Buffer.from(signature, "hex"); // invalid hex yields a shorter buffer, caught by the length check
  return given.length === expected.length && timingSafeEqual(given, expected);
}
