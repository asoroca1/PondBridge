import { cedarSitemapXml, requestTargetsCedar } from "../apps/web/src/lib/cedarSeo.js";

export async function onRequest(context) {
  if (!requestTargetsCedar(context.request)) return context.next();

  return new Response(cedarSitemapXml(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/xml; charset=utf-8",
      "X-Robots-Tag": "noindex"
    }
  });
}
