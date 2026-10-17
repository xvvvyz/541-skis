// The print file for a custom pair, after the order email goes out: upscale
// the art, build the print file and email the shop a link to it. It runs as
// a Cloudflare Workflow, so each step is retried on its own and the wait for
// the upscaler survives restarts.

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { SkiId } from "../client/ski";
import { notify } from "./email";
import type { Env } from "./env";
import { buildSheet } from "./sheet";
import {
  checkUpscale,
  FACTOR,
  forget,
  save,
  startUpscale,
  type Check,
} from "./upscale";

export interface Job {
  order: string;
  // Part of the download link, so it can't be guessed.
  token: string;
  ski: SkiId;
  marks: string[];
  // Each mark's outline colour, or "" for none. Missing on prints started
  // before marks could be outlined.
  outlines?: string[];
  customer: string;
  title: string;
  // Where the site lives, for the download link.
  origin: string;
}

const RETRY = {
  retries: { backoff: "exponential", delay: "10 seconds", limit: 5 },
  timeout: "5 minutes",
} as const;

export const artKey = (order: string) => `orders/${order}/art.jpg`;
const printKey = (order: string, token: string) =>
  `orders/${order}/${token}.pdf`;

// The download link in the email.
export async function printFile(env: Env, order: string, token: string) {
  const object = await env.ART.get(printKey(order, token));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": `attachment; filename="541-${order}.pdf"`,
      "content-length": String(object.size),
      "content-type": "application/pdf",
    },
  });
}

export class Print extends WorkflowEntrypoint<Env, Job> {
  async run(event: WorkflowEvent<Job>, step: WorkflowStep) {
    const job = event.payload;
    const art = await upscale(step, this.env, job.order);

    let print: Awaited<ReturnType<typeof buildSheet>>;
    try {
      print = await step.do("build the print file", RETRY, () =>
        buildSheet(this.env.ART, {
          art: art.key,
          key: printKey(job.order, job.token),
          marks: job.marks,
          outlines: job.outlines ?? ["", ""],
          ski: job.ski,
          title: `${job.title}, ${job.customer}`,
        }),
      );
    } catch (cause) {
      await step.do("email the problem", RETRY, () =>
        notify(this.env, {
          replyTo: job.customer,
          subject: `No print file: ${job.title} for ${job.customer}`,
          text: `The print file for ${job.customer}'s ${job.title} couldn't be made (${cause}). Their artwork is attached to the order email.`,
        }),
      );
      return;
    }

    await step.do("email the print file", RETRY, () =>
      notify(this.env, {
        replyTo: job.customer,
        subject: `Print file: ${job.title} for ${job.customer}`,
        text: [
          `The print file for ${job.customer}'s ${job.title} is ready:`,
          new URL(`/print/${job.order}/${job.token}`, job.origin).href,
          art.problem &&
            `Art at its original ${print.dpi} dpi: ${art.problem}, so it may print soft.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    );
  }
}

// The art to print: upscaled when that works, else the original, with what
// went wrong. Upscaling can make the print sharper, never stop it.
async function upscale(step: WorkflowStep, env: Env, order: string) {
  const original = artKey(order);
  const token = env.REPLICATE_API_TOKEN;
  if (!token) return { key: original, problem: "no upscaler is set up" };

  let prediction: { file: string; id: string } | undefined;
  try {
    prediction = await step.do("start upscaling", RETRY, () =>
      startUpscale(env.ART, token, original),
    );
    // Check every 20 seconds, for up to 15 minutes.
    let result: Check = { done: false };
    for (let i = 0; i < 45 && !result.done; i++) {
      await step.sleep(`wait ${i + 1}`, "20 seconds");
      result = await step.do(`check ${i + 1}`, RETRY, () =>
        checkUpscale(token, prediction!),
      );
    }
    if (!result.output) {
      return {
        key: original,
        problem: result.done
          ? `upscaling failed (${result.error})`
          : "upscaling took too long",
      };
    }
    const key = `orders/${order}/art-${FACTOR}x.jpg`;
    await step.do("save the upscaled art", RETRY, () =>
      save(env.ART, token, result.output!, key),
    );
    return { key, problem: "" };
  } catch (cause) {
    return { key: original, problem: `upscaling failed (${cause})` };
  } finally {
    if (prediction) {
      const file = prediction.file;
      await step.do("clean up", RETRY, () => forget(token, file));
    }
  }
}
