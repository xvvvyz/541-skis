// Emails from the site: to the shop, with a copy to ORDER_COPY.

import { EmailMessage } from "cloudflare:email";
import type { Env } from "./env";

type Attachment = { data: string; name: string };

// Sends to the shop, then the copy. Only the shop's has to go through; a
// failed copy is logged, so a retry never sends the shop the same email
// twice.
export async function notify(
  env: Env,
  message: {
    attachments?: Attachment[];
    replyTo: string;
    subject: string;
    text: string;
  },
) {
  const raw = mime({
    attachments: message.attachments ?? [],
    from: env.ORDER_FROM,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    to: [env.ORDER_TO, env.ORDER_COPY].filter(Boolean).join(", "),
  });
  await env.MAILER.send(new EmailMessage(env.ORDER_FROM, env.ORDER_TO, raw));
  if (env.ORDER_COPY) {
    await env.MAILER.send(
      new EmailMessage(env.ORDER_FROM, env.ORDER_COPY, raw),
    ).catch((cause) => console.error("copy email failed", cause));
  }
}

// A plain-text email with image attachments, as raw MIME.
function mime(message: {
  attachments: Attachment[];
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  to: string;
}) {
  const boundary = `541-${crypto.randomUUID()}`;
  const wrap = (base64: string) => base64.replace(/.{76}/g, "$&\r\n");
  const utf8 = (value: string) =>
    wrap(btoa(String.fromCharCode(...new TextEncoder().encode(value))));
  const header = (value: string) =>
    `=?utf-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;

  const parts = [
    [
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      utf8(message.text),
    ].join("\r\n"),
    ...message.attachments.map(({ data, name }) => {
      const [, type, base64] = data.match(/^data:(image\/\w+);base64,(.*)$/)!;
      const filename = `${name}.${type.split("/")[1].replace("jpeg", "jpg")}`;
      return [
        `Content-Type: ${type}; name="${filename}"`,
        `Content-Disposition: attachment; filename="${filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap(base64),
      ].join("\r\n");
    }),
  ];

  return [
    `From: 541 Skis <${message.from}>`,
    `To: ${message.to}`,
    `Reply-To: ${message.replyTo}`,
    `Subject: ${header(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@541.ski>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((part) => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
