import type { SendEmail } from "@cloudflare/workers-types";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  readonly name: "console" | "cloudflare";
  send(message: OutboundEmail): Promise<void>;
}

export interface MailboxMessage {
  to: string;
  subject: string;
  text: string;
  createdAt: number;
}

interface MailboxDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
    };
  };
}

/** Writes the message into dev_mailbox. Used for local development and tests. */
export function consoleEmailProvider(db: MailboxDb): EmailProvider {
  return {
    name: "console",
    async send(message) {
      const createdAt = Date.now();
      console.log(JSON.stringify({
        event: "dev_email",
        to: message.to,
        subject: message.subject,
      }));
      await db.prepare(
        "INSERT INTO dev_mailbox (id, to_address, subject, text_body, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), message.to, message.subject, message.text, createdAt).run();
    },
  };
}

export function cloudflareEmailProvider(binding: SendEmail, fromAddress: string): EmailProvider {
  return {
    name: "cloudflare",
    async send(message) {
      await binding.send({
        to: message.to,
        from: { email: fromAddress, name: "Blackthorn Rugby" },
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

export function renderMagicLink(input: { origin: string; path: string; token: string; kind: "login" | "invite" }): OutboundEmail {
  const url = `${input.origin}${input.path}?token=${encodeURIComponent(input.token)}`;
  const subject = input.kind === "invite"
    ? "You're invited to Blackthorn Rugby"
    : "Your Blackthorn Rugby sign-in link";
  const intro = input.kind === "invite"
    ? "A coach invited you to the Blackthorn Rugby offseason platform."
    : "Use this link to sign in. It expires in 15 minutes and works once.";
  const text = `${intro}\n\n${url}\n\nIf you did not expect this email, you can ignore it.`;
  const html = `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}">Continue</a></p><p>If you did not expect this email, you can ignore it.</p>`;
  return { to: "", subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
