import { ClerkProvider } from "@clerk/clerk-react";
import { AuthProvider } from "./AuthProviderRuntime.jsx";
import { clerkSdkEnabled, CLERK_PUBLISHABLE_KEY } from "../lib/authMode.js";

const clerkNoSocialAppearance = {
  elements: {
    socialButtons: { display: "none" },
    socialButtonsBlock: { display: "none" },
    socialButtonsBlockButton: { display: "none" },
    socialButtonsIconButton: { display: "none" },
    dividerRow: { display: "none" },
    dividerLine: { display: "none" },
    dividerText: { display: "none" }
  }
};

export default function FullAuthRuntime({ children }) {
  const app = <AuthProvider>{children}</AuthProvider>;
  if (!clerkSdkEnabled()) return app;

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      appearance={clerkNoSocialAppearance}
    >
      {app}
    </ClerkProvider>
  );
}
