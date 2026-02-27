import React from "react";
import { Link } from "react-router-dom";
import Navbar1 from "../components/Navbar1";
import ClerkCreateAccountFlow from "../components/ClerkCreateAccountFlow";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../../lib/authMode.js";

export default function CreateProfileWizard() {
  if (clerkUiEnabled()) {
    return <ClerkCreateAccountFlow />;
  }

  if (clerkModeRequested()) {
    return (
      <div className="wizard1 wizard1--create">
        <Navbar1 />
        <section className="wizard1-main">
          <div className="wizard1-card">
            <h1 className="wizard1-h1">Create Account</h1>
            <p className="login1-error">
              {clerkConfigError() || "Clerk auth is enabled but web auth configuration is incomplete."}
            </p>
            <p className="wizard1-sub">
              Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web app.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="wizard1 wizard1--create">
      <Navbar1 />
      <section className="wizard1-main">
        <div className="wizard1-card">
          <h1 className="wizard1-h1">Create Account</h1>
          <p className="wizard1-sub">
            Account creation now only sets up login credentials. Profile details are completed later in Edit Profile.
          </p>
          <p className="wizard1-sub" style={{ marginTop: 8 }}>
            <Link to="../login">Go to login</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
