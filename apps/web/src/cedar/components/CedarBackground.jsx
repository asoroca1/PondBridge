// src/components/CedarBackground.jsx
import React from "react";
import bgImage from "../assets/cedar-bg.png";

/**
 * behavior:
 * - "fixed": one global BG that stays fixed to the window for the whole page
 * - "scroll": BG is part of the document flow and scrolls normally
 * - "sticky": BG locks to the viewport while its parent section is in view
 */
export default function CedarBackground({
  behavior = "fixed",         // "fixed" | "scroll" | "sticky"
  zIndex = 0,
  opacity = 1,
  style = {},
  image = bgImage,            // allow override per section if you want
  position = "center",        // e.g., "center", "top", "center 30%"
  size = "cover",
}) {
  const isFixed = behavior === "fixed";
  const isSticky = behavior === "sticky";

  const base = {
    width: "100%",
    backgroundImage: `url(${image})`,
    backgroundSize: size,
    backgroundPosition: position,
    backgroundRepeat: "no-repeat",
    opacity,
    pointerEvents: "none",
    zIndex,
    ...style,
  };

  let modeStyles = {};
  if (isFixed) {
    modeStyles = {
      position: "fixed",
      inset: 0,
      height: "100%",
      backgroundAttachment: "fixed",
    };
  } else if (isSticky) {
    // IMPORTANT: render this INSIDE the section you want it to lock to.
    // It will stay stuck to the viewport while that section scrolls past.
    modeStyles = {
      position: "sticky",
      top: 0,
      height: "100vh",
      // Do NOT use background-attachment: fixed here—sticky does the job.
    };
  } else {
    // normal scrolling background
    modeStyles = {
      position: "absolute",
      inset: 0,
      height: "100%",
    };
  }

  return <div style={{ ...base, ...modeStyles }} />;
}
