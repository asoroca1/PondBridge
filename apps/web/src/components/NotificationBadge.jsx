function cx(...values) {
  return values.filter(Boolean).join(" ");
}

export default function NotificationBadge({
  count = 0,
  max = 99,
  size = "md",
  tone = "brand",
  floating = false,
  className = "",
  ariaLabel = ""
}) {
  const numericCount = Number(count || 0);
  if (!Number.isFinite(numericCount) || numericCount <= 0) return null;

  const display = numericCount > max ? `${max}+` : String(numericCount);
  const label = ariaLabel || `${display} unread notifications`;

  return (
    <span
      className={cx(
        "pb-notification-badge",
        `is-${size}`,
        `tone-${tone}`,
        floating && "is-floating",
        className
      )}
      aria-label={label}
    >
      {display}
    </span>
  );
}
