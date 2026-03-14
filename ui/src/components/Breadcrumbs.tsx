import { Link } from "react-router-dom";

interface Crumb {
  uuid?: string;
  name: string;
  href: string;
}

interface Props {
  crumbs: Crumb[];
}

export default function Breadcrumbs({ crumbs }: Props) {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.5rem 1.25rem",
        background: "#0f172a",
        color: "#94a3b8",
        fontSize: "0.85rem",
        borderBottom: "1px solid #1e293b",
        flexWrap: "wrap",
      }}
    >
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          {i > 0 && <span style={{ color: "#475569" }}>&gt;</span>}
          {i === crumbs.length - 1 ? (
            <span style={{ color: "#e2e8f0" }}>{crumb.name}</span>
          ) : (
            <Link
              to={crumb.href}
              style={{ color: "#60a5fa", textDecoration: "none" }}
            >
              {crumb.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
