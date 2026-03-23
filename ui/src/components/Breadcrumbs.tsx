import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  color?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  "data-testid"?: string;
}

export default function Breadcrumbs({ items, "data-testid": testId }: BreadcrumbsProps) {
  return (
    <nav
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.5rem 1.25rem",
        background: "#0f172a",
        borderBottom: "1px solid #1e293b",
        fontSize: "0.85rem",
        flexWrap: "wrap",
      }}
    >
      {items.map((item, i) => (
        <span
          key={i}
          style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
        >
          {i > 0 && <span style={{ color: "#475569" }}>&gt;</span>}
          {item.href ? (
            <Link to={item.href} style={{ color: "#60a5fa", textDecoration: "none" }}>
              {item.label}
            </Link>
          ) : (
            <span style={{ color: item.color ?? "#e2e8f0" }}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
