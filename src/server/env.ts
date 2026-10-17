export interface Env {
  ART: R2Bucket;
  ASSETS: Fetcher;
  DB: D1Database;
  DESIGN_LIMIT: RateLimit;
  MAILER: SendEmail;
  OPENROUTER_API_KEY: string;
  ORDER_LIMIT: RateLimit;
  // Email addresses, kept out of the repo as secrets: where order emails
  // come from and go to, who gets a copy, and the contact shown on the site.
  ORDER_FROM: string;
  ORDER_TO: string;
  ORDER_COPY?: string;
  CONTACT_EMAIL?: string;
  PRINT: Workflow;
  // Optional: without it, print files use the art at its original size.
  REPLICATE_API_TOKEN?: string;
}
