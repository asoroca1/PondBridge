import { Link } from "react-router-dom";
import { Card, PageShell } from "@pondbridge/ui";

export default function NotFoundPage() {
  const knownSlug =
    typeof window !== "undefined" ? String(localStorage.getItem("pondbridgeTenantSlug") || "").trim() : "";
  const destination = knownSlug ? `/t/${knownSlug}` : "/";

  return (
    <PageShell>
      <Card>
        <h1>Page not found</h1>
        <p>This route does not exist in the PondBridge app.</p>
        <Link to={destination}>Go to your camp network</Link>
      </Card>
    </PageShell>
  );
}
