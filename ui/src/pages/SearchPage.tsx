import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { search } from "../lib/api";
import SearchForm from "../components/SearchForm";
import SearchResultsTable from "../components/SearchResultsTable";

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const committedQ = searchParams.get("q") ?? "";
  const committedField = searchParams.get("field") ?? "";
  const committedScope = searchParams.get("scope") ?? "";
  const committedWorkflowId = searchParams.get("workflowId") ?? "";
  const committedFrom = searchParams.get("from") ?? "";
  const committedTo = searchParams.get("to") ?? "";

  const fromISO = committedFrom ? `${committedFrom}T00:00:00Z` : undefined;
  const toISO = committedTo ? `${committedTo}T23:59:59Z` : undefined;

  const { data, isLoading } = useQuery({
    queryKey: [
      "search",
      committedQ,
      committedField,
      committedScope,
      committedWorkflowId,
      committedFrom,
      committedTo,
    ],
    queryFn: () =>
      search(committedQ, {
        field: (committedField as "name" | "uri" | "pin" | "path") || undefined,
        scope: (committedScope as "workflows" | "steps" | "all") || "all",
        workflowId: committedWorkflowId || undefined,
        from: fromISO,
        to: toISO,
      }),
    enabled: committedQ.length > 0,
    staleTime: 0,
  });

  function handleSubmit(values: {
    q: string;
    field: string;
    scope: string;
    workflowId: string;
    from: string;
    to: string;
  }) {
    const p = new URLSearchParams();
    if (values.q) p.set("q", values.q);
    if (values.field) p.set("field", values.field);
    if (values.scope) p.set("scope", values.scope);
    if (values.workflowId) p.set("workflowId", values.workflowId);
    if (values.from) p.set("from", values.from);
    if (values.to) p.set("to", values.to);
    setSearchParams(p);
  }

  return (
    <div
      data-testid="search-page"
      style={{
        background: "#0f172a",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          padding: "0.75rem 1.5rem",
        }}
      >
        <Link
          to="/"
          style={{
            color: "#f1f5f9",
            fontWeight: 600,
            fontSize: "1rem",
            textDecoration: "none",
          }}
        >
          WorkflowUI
        </Link>
      </header>

      <div
        style={{
          margin: "0 auto",
          maxWidth: 1000,
          padding: "2rem 1.5rem",
        }}
      >
        <h2
          style={{
            color: "#f1f5f9",
            fontSize: "1.25rem",
            fontWeight: 600,
            margin: "0 0 1.25rem",
          }}
        >
          Advanced Search
        </h2>

        <SearchForm
          initialValues={{
            q: committedQ,
            field: committedField,
            scope: committedScope,
            workflowId: committedWorkflowId,
            from: committedFrom,
            to: committedTo,
          }}
          onSubmit={handleSubmit}
        />

        <SearchResultsTable
          results={data?.results ?? []}
          isLoading={isLoading}
          hasQuery={committedQ.length > 0}
        />
      </div>
    </div>
  );
}
