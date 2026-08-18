import { Link } from "react-router-dom";
import { Card, PageShell } from "@pondbridge/ui";

export default function NotFoundPage() {
  const knownSlug =
    typeof window !== "undefined" ? String(localStorage.getItem("pondbridgeTenantSlug") || "").trim() : "";
  const destination = knownSlug ? `/t/${knownSlug}` : "/";

  return (
    <PageShell>
      <Card style={{ textAlign: "center", maxWidth: 480, margin: "60px auto", padding: 32 }}>
        <p style={{ fontSize: 48, margin: "0 0 8px", lineHeight: 1 }} aria-hidden="true">🔍</p>
        <h1 style={{ margin: "0 0 8px" }}>Page Not Found</h1>
        <p style={{ color: "var(--text-muted, var(--neutral-600))", margin: "0 0 20px" }}>
          We couldn&apos;t find what you were looking for. The page may have moved or no longer exists.
        </p>
        <Link to={destination} style={{ fontWeight: 700, color: "var(--brand-primary, var(--brand-primary-strong))" }}>
          ← Back to your network
        </Link>
      </Card>
    </PageShell>
  );
}
