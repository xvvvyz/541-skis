import {
  art,
  card,
  design,
  details,
  saveCard,
  sharePage,
} from "./server/designs";
import type { Env } from "./server/env";
import { error } from "./server/http";
import { order } from "./server/order";
import { printFile } from "./server/print";

export { Print } from "./server/print";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.541.ski") {
      url.hostname = "541.ski";
      return Response.redirect(url.href, 301);
    }

    const shared = url.pathname.match(
      /^\/(api\/designs|art|card|d)\/([\w-]{16})(\/card)?$/,
    );
    if (shared && request.method === "GET" && !shared[3]) {
      const [, route, id] = shared;
      if (route === "art") return art(env, `designs/${id}`);
      if (route === "card") return card(request, env, id);
      if (route === "d") return sharePage(request, env, id);
      return details(env, id);
    }

    const print = url.pathname.match(/^\/print\/([\w-]{16})\/([\w-]{16})$/);
    if (print && request.method === "GET") {
      return printFile(env, print[1], print[2]);
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST") return error(405, "Method not allowed");

      const origin = request.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) {
        return error(403, "Forbidden");
      }

      const ip = request.headers.get("cf-connecting-ip") ?? "local";
      if (url.pathname === "/api/design") return design(request, env, ip);
      if (shared?.[1] === "api/designs" && shared[3]) {
        return saveCard(request, env, shared[2]);
      }
      if (url.pathname === "/api/order") return order(request, env, ip);
      return error(404, "Not found");
    }

    return assets(request, env);
  },
} satisfies ExportedHandler<Env>;

// Example designs and photos rarely change, so browsers keep them a day and
// then refresh them in the background. Everything else revalidates. Pages
// get the contact email, which stays out of the repo.
async function assets(request: Request, env: Env) {
  const response = await env.ASSETS.fetch(request);
  const { pathname } = new URL(request.url);
  if (response.headers.get("content-type")?.startsWith("text/html")) {
    return withContact(response, env.CONTACT_EMAIL);
  }
  if (!response.ok || !/^\/(designs|images|og)\//.test(pathname)) {
    return response;
  }
  const cached = new Response(response.body, response);
  cached.headers.set(
    "cache-control",
    "public, max-age=86400, stale-while-revalidate=604800",
  );
  return cached;
}

function withContact(response: Response, email?: string) {
  return new HTMLRewriter()
    .on("a[data-contact]", {
      element(link) {
        if (email) {
          link.setAttribute("href", `mailto:${email}`);
          link.setInnerContent(email);
        } else {
          link.remove();
        }
      },
    })
    .transform(response);
}
