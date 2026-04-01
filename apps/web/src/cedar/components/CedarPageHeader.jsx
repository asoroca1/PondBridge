import "./cedar-page-header.css";

/**
 * Shared page-header card used across cedar feature pages.
 *
 * @example
 * <CedarPageHeader icon={<MapPin size={18}/>} title="Location Map" subtitle="Find alumni.">
 *   optional right-side content (filters, buttons, tabs)
 * </CedarPageHeader>
 */
export default function CedarPageHeader({ icon, title, subtitle, children, className = "" }) {
  return (
    <header className={`cedar-ph ${className}`.trim()}>
      <div className="cedar-ph-left">
        <div className="cedar-ph-title-row">
          {icon && <span className="cedar-ph-icon">{icon}</span>}
          <h1 className="cedar-ph-title">{title}</h1>
        </div>
        {subtitle && <p className="cedar-ph-sub">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}
