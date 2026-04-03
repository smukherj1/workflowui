import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { search } from "../lib/api";
import SearchForm from "../components/SearchForm";
import SearchResultsTable from "../components/SearchResultsTable";

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const committedQ = searchParams.get("q") ?? "";
  const committedName = searchParams.get("name") ?? "";
  const committedUri = searchParams.get("uri") ?? "";
  const committedPin = searchParams.get("pin") ?? "";
  const committedPath = searchParams.get("path") ?? "";
  const committedWorkflowId = searchParams.get("workflowId") ?? "";
  const committedFrom = searchParams.get("from") ?? "";
  const committedTo = searchParams.get("to") ?? "";

  const fromISO = committedFrom ? `${committedFrom}T00:00:00Z` : undefined;
  const toISO = committedTo ? `${committedTo}T23:59:59Z` : undefined;

  const hasAnyTerm =
    committedQ.length > 0 ||
    committedName.length > 0 ||
    committedUri.length > 0 ||
    committedPin.length > 0 ||
    committedPath.length > 0;

  const { data, isLoading } = useQuery({
    queryKey: [
      "search",
      committedQ,
      committedName,
      committedUri,
      committedPin,
      committedPath,
      committedWorkflowId,
      committedFrom,
      committedTo,
    ],
    queryFn: () =>
      search(committedQ || null, {
        name: committedName || undefined,
        uri: committedUri || undefined,
        pin: committedPin || undefined,
        path: committedPath || undefined,
        workflowId: committedWorkflowId || undefined,
        from: fromISO,
        to: toISO,
      }),
    enabled: hasAnyTerm,
    staleTime: 0,
  });

  function handleSubmit(values: {
    q: string;
    name: string;
    uri: string;
    pin: string;
    path: string;
    from: string;
    to: string;
  }) {
    const p = new URLSearchParams();
    if (values.q) p.set("q", values.q);
    if (values.name) p.set("name", values.name);
    if (values.uri) p.set("uri", values.uri);
    if (values.pin) p.set("pin", values.pin);
    if (committedWorkflowId) {
      p.set("workflowId", committedWorkflowId);
      if (values.path) p.set("path", values.path);
    }
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
            name: committedName,
            uri: committedUri,
            pin: committedPin,
            path: committedPath,
            from: committedFrom,
            to: committedTo,
          }}
          workflowId={committedWorkflowId || undefined}
          onSubmit={handleSubmit}
        />

        <SearchResultsTable
          results={data?.results ?? []}
          isLoading={isLoading}
          hasQuery={hasAnyTerm}
        />
      </div>
    </div>
  );
}
