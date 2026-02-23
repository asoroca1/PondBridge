import React from "react";

export default function ComingSoon({ title = "Coming Soon" }) {
  return (
    <div className="comingsoon1">
      <main className="nav2-page-shell">
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "1rem" }}>
          <h1 style={{ fontSize: "2rem", marginBottom: ".5rem" }}>{title}</h1>
          <p>This page is in progress. Check back soon!</p>
        </div>
      </main>
    </div>
  );
}
