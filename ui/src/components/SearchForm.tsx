import { useState } from "react";

interface SearchFormValues {
  q: string;
  name: string;
  uri: string;
  pin: string;
  path: string;
  from: string;
  to: string;
}

interface Props {
  initialValues: SearchFormValues;
  onSubmit: (values: SearchFormValues) => void;
  /** When set, shows path input and displays workflowId as read-only context */
  workflowId?: string;
}

export default function SearchForm({
  initialValues,
  onSubmit,
  workflowId,
}: Props) {
  const [q, setQ] = useState(initialValues.q);
  const [name, setName] = useState(initialValues.name);
  const [uri, setUri] = useState(initialValues.uri);
  const [pin, setPin] = useState(initialValues.pin);
  const [path, setPath] = useState(initialValues.path);
  const [from, setFrom] = useState(initialValues.from);
  const [to, setTo] = useState(initialValues.to);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    onSubmit({ q, name, uri, pin, path, from, to });
  }

  function handleClear() {
    setQ("");
    setName("");
    setUri("");
    setPin("");
    setPath("");
    setFrom("");
    setTo("");
    onSubmit({
      q: "",
      name: "",
      uri: "",
      pin: "",
      path: "",
      from: "",
      to: "",
    });
  }

  const inputStyle = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 4,
    color: "#f1f5f9",
    fontSize: "0.875rem",
    outline: "none",
    padding: "0.4rem 0.6rem",
  } as const;

  function fieldBlock(
    label: string,
    testId: string,
    value: string,
    onChange: (v: string) => void,
    flex = "1 1 160px",
  ) {
    return (
      <div
        style={{
          flex,
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        <label style={{ color: "#94a3b8", fontSize: "0.75rem" }}>{label}</label>
        <input
          type="text"
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder={label + "..."}
          style={inputStyle}
        />
      </div>
    );
  }

  return (
    <form
      data-testid="search-form"
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem",
        alignItems: "flex-end",
        padding: "1rem",
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 8,
        marginBottom: "1.5rem",
      }}
    >
      {fieldBlock("General search", "search-input-q", q, setQ, "1 1 200px")}
      {fieldBlock("Name", "search-input-name", name, setName)}
      {fieldBlock("URI", "search-input-uri", uri, setUri)}
      {fieldBlock("Pin", "search-input-pin", pin, setPin)}

      {workflowId && fieldBlock("Path", "search-input-path", path, setPath)}

      {/* Workflow ID — read-only context when set */}
      {workflowId && (
        <div
          style={{
            flex: "1 1 160px",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          <label style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
            Workflow ID
          </label>
          <input
            type="text"
            value={workflowId}
            readOnly
            placeholder="UUID..."
            style={{
              background: "#0a0f1a",
              border: "1px solid #334155",
              borderRadius: 4,
              color: "#475569",
              fontSize: "0.875rem",
              outline: "none",
              padding: "0.4rem 0.6rem",
              cursor: "default",
            }}
          />
        </div>
      )}

      {/* From date */}
      <div
        style={{
          flex: "0 1 140px",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        <label style={{ color: "#94a3b8", fontSize: "0.75rem" }}>From</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 4,
            color: "#f1f5f9",
            colorScheme: "dark",
            fontSize: "0.875rem",
            outline: "none",
            padding: "0.4rem 0.6rem",
          }}
        />
      </div>

      {/* To date */}
      <div
        style={{
          flex: "0 1 140px",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        <label style={{ color: "#94a3b8", fontSize: "0.75rem" }}>To</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 4,
            color: "#f1f5f9",
            colorScheme: "dark",
            fontSize: "0.875rem",
            outline: "none",
            padding: "0.4rem 0.6rem",
          }}
        />
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <button
          type="submit"
          style={{
            background: "#2563eb",
            border: "none",
            borderRadius: 4,
            color: "#fff",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 500,
            padding: "0.45rem 1rem",
          }}
        >
          Search
        </button>
        <button
          type="button"
          onClick={handleClear}
          style={{
            background: "transparent",
            border: "1px solid #334155",
            borderRadius: 4,
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "0.875rem",
            padding: "0.45rem 1rem",
          }}
        >
          Clear
        </button>
      </div>
    </form>
  );
}
