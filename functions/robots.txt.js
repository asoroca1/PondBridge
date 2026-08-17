import { cedarRobotsTxt, requestTargetsCedar } from "../apps/web/src/lib/cedarSeo.js";

export async function onRequest(context) {
  if (!requestTargetsCedar(context.request)) return context.next();

  return new Response(cedarRobotsTxt(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
