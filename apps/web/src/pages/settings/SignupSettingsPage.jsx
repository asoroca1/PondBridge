import { Link, useParams } from "react-router-dom";
import { Card, PageShell, SectionTitle } from "@pondbridge/ui";

export default function SignupSettingsPage() {
  const { slug } = useParams();

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <SectionTitle>Signup Settings</SectionTitle>
        <p className="muted">This area is being rebuilt as part of the new onboarding flow.</p>
        <div className="inline-actions">
          <Link className="link-button secondary" to={`/t/${slug}/onboarding`}>
            Back to onboarding
          </Link>
        </div>
      </Card>
    </PageShell>
  );
}
