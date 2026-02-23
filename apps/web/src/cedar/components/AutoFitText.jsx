// src/components/AutoFitText.jsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * AutoFitText
 * Shrinks (or optionally grows) font-size so content fits on ONE line.
 *
 * Props:
 * - as: element tag (default 'div')
 * - max: max font size in px; if omitted we use the current computed font-size
 * - min: minimum font size in px (default 12)
 * - shrinkOnly: boolean (default true). When true, never exceed the computed size.
 * - weight, className, style, children
 */
export default function AutoFitText({
  as: Tag = "div",
  max,                 // optional; will default to computed size
  min = 12,
  shrinkOnly = true,   // <= NEW
  weight,
  className = "",
  style,
  children,
  ...rest
}) {
  const ref = useRef(null);
  const [size, setSize] = useState(null);
  const textKey = useMemo(() => String(children), [children]);

  const fit = () => {
    const el = ref.current;
    if (!el) return;

    // figure out our max: default to computed CSS size
    const cs = getComputedStyle(el);
    const computedPx = parseFloat(cs.fontSize) || 16;
    const maxPx = Math.max(1, (max ?? computedPx));
    const ceiling = shrinkOnly ? Math.min(maxPx, computedPx) : maxPx;

    // reset to ceiling for fresh measure
    el.style.fontSize = `${ceiling}px`;
    el.style.whiteSpace = "nowrap";
    el.style.overflow = "hidden";

    const available = el.clientWidth;
    if (available <= 0) return;

    // If we already fit at ceiling, we’re done
    if (el.scrollWidth <= available) {
      setSize(ceiling);
      return;
    }

    // Binary search between min..ceiling
    let lo = min;
    let hi = ceiling;
    let best = min;

    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (el.scrollWidth <= available) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    setSize(Math.max(min, Math.min(best, ceiling)));
  };

  useLayoutEffect(() => { fit(); }, [textKey, max, min, shrinkOnly]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [max, min, shrinkOnly]);

  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "clip",
        fontWeight: weight,
        fontSize: size ? `${size}px` : undefined,
        ...style
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
