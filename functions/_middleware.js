// Stamps the camp's own name onto every HTML page the edge serves.
//
// A link to a camp - an invite, a magic link, the home page - used to unfurl as
// "PondBridge" in Mail and iMessage, because index.html ships that title and the
// bundle only corrects it after mount, which an unfurler never waits for. This runs
// the same tenant lookup /brand/* already does and rewrites the head before the
// document leaves Cloudflare.
//
// Camp Cedar's landing page carries richer marketing SEO owned by functions/index.js;
// this defers to it on that one path rather than writing over it.
import { requestTargetsCedar } from "../apps/web/src/lib/cedarSeo.js";
import { resolveApiBaseUrl } from "../apps/web/src/lib/tenantBrandAssets.js";
import { buildTenantPageSeo, tenantHeadMarkup } from "../apps/web/src/lib/tenantPageSeo.js";

// Matches the /brand/* function so a page and its icon share one cached lookup.
const TENANT_LOOKUP_TTL_SECONDS = 300;

async function fetchTenantConfig(apiBase, hostname) {
  const endpoint = `${apiBase}/api/public/tenant-config?host=${encodeURIComponent(hostname)}`;
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: TENANT_LOOKUP_TTL_SECONDS, cacheEverything: true }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Whether a path is an application route rather than a file.
 *
 * Every SPA route is extension-less; the entries _redirects self-maps - robots.txt,
 * the icons, the manifest - carry one, and are meant to stay 404 when absent rather
 * than answer with a page. /brand/* is a Function that 404s deliberately.
 */
export function looksLikeAppRoute(pathname = "") {
  const path = String(pathname || "/");
  if (path.startsWith("/brand/")) return false;
  const lastSegment = path.split("/").pop() || "";
  return !lastSegment.includes(".");
}

/**
 * The SPA shell, served directly.
 *
 * _redirects rules are documented not to apply to a request a Function handles, and
 * every application route reaches the app through the "/* / 200" rule in that file.
 * Deep links - an invite lands on /create-account - would 404 the moment this
 * middleware started matching them, so the rewrite is performed here instead.
 */
async function serveAppShell(context, url) {
  try {
    const shell = await context.env.ASSETS.fetch(new URL("/", url));
    if (!shell.ok) return null;
    return new Response(shell.body, { status: 200, headers: shell.headers });
  } catch {
    return null;
  }
}

class TitleHandler {
  constructor(title) {
    this.title = title;
  }

  element(element) {
    element.setInnerContent(this.title);
  }
}

class ContentAttributeHandler {
  constructor(content) {
    this.content = content;
  }

  element(element) {
    element.setAttribute("content", this.content);
  }
}

class HeadHandler {
  constructor(markup) {
    this.markup = markup;
  }

  element(element) {
    element.append(this.markup, { html: true });
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let response = await context.next();

  // functions/index.js owns Cedar's landing page and its richer marketing SEO; every
  // other Cedar page - the invite link included - is branded here like any camp. A
  // non-read request is nothing to brand.
  const cedarLandingPage = requestTargetsCedar(request) && url.pathname === "/";
  if (cedarLandingPage || (request.method !== "GET" && request.method !== "HEAD")) {
    return response;
  }

  if (response.status === 404 && looksLikeAppRoute(url.pathname)) {
    const shell = await serveAppShell(context, url);
    if (!shell) return response;
    response = shell;
  }
  if (!response.ok) return response;

  const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("text/html")) return response;

  const tenant = await fetchTenantConfig(resolveApiBaseUrl(env, request.url), url.hostname);
  const seo = buildTenantPageSeo(tenant, request.url);
  // No camp resolved for this host: leave the platform's own copy alone rather than
  // guessing at a name.
  if (!seo) return response;

  return new HTMLRewriter()
    .on("title", new TitleHandler(seo.title))
    .on('meta[name="description"]', new ContentAttributeHandler(seo.description))
    .on('meta[name="apple-mobile-web-app-title"]', new ContentAttributeHandler(seo.campName))
    .on("head", new HeadHandler(tenantHeadMarkup(seo)))
    .transform(response);
}
