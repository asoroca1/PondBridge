function normalizeInitials(value = "") {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!text) return ["?"];
  return text.slice(0, 2).split("");
}

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

export default function InitialsMark({ value = "", className = "", ariaHidden = true }) {
  const chars = normalizeInitials(value);

  return (
    <span
      className={cx("pb-initials-mark", className)}
      data-count={chars.length}
      aria-hidden={ariaHidden}
    >
      {chars.map((char, index) => (
        <span key={`${char}-${index}`} className="pb-initials-mark__char">
          {char}
        </span>
      ))}
    </span>
  );
}
