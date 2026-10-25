import { Resend } from "resend";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Resend drops a repeat send with the same key, a second guard against double alerts. */
  idempotencyKey?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createResendSender(apiKey: string, from: string): EmailSender {
  const resend = new Resend(apiKey);
  return {
    async send({ to, subject, html, text, idempotencyKey }) {
      const { error } = await resend.emails.send({ from, to, subject, html, text }, idempotencyKey ? { idempotencyKey } : undefined);
      if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
    },
  };
}
