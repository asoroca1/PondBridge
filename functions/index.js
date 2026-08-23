import {
  CEDAR_PUBLIC_SEO,
  cedarHeadMarkup,
  cedarLandingFallbackMarkup,
  requestTargetsCedar
} from "../apps/web/src/lib/cedarSeo.js";

class CedarTitleHandler {
  element(element) {
    element.setInnerContent(CEDAR_PUBLIC_SEO.title);
  }
}

class CedarDescriptionHandler {
  element(element) {
    element.setAttribute("content", CEDAR_PUBLIC_SEO.description);
  }
}

class CedarHeadHandler {
  element(element) {
    element.append(cedarHeadMarkup(), { html: true });
  }
}

class CedarRootHandler {
  element(element) {
    element.setInnerContent(cedarLandingFallbackMarkup(), { html: true });
  }
}

export async function onRequest(context) {
  const response = await context.next();
  if (!requestTargetsCedar(context.request) || !response.ok) return response;

  const headers = new Headers(response.headers);
  headers.set("Content-Language", "en-US");
  headers.set("X-Robots-Tag", "index, follow");
  const seoResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });

  if (context.request.method === "HEAD") return seoResponse;
  const contentType = String(headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("text/html")) return seoResponse;

  return new HTMLRewriter()
    .on("title", new CedarTitleHandler())
    .on('meta[name="description"]', new CedarDescriptionHandler())
    .on("head", new CedarHeadHandler())
    .on("#root", new CedarRootHandler())
    .transform(seoResponse);
}
