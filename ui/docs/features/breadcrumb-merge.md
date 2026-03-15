# Feature: Unified Breadcrumb Bar

## Problem

The current UI has two separate breadcrumb rows:

1. **Workflow breadcrumb** — rendered by `WorkflowLayout`, always shows the workflow name as a link back to the top-level DAG.
2. **Step breadcrumbs** — rendered by `StepView`, shows `> Parent > Child > Current` when viewing a nested step.

This creates two issues:
- The step breadcrumb row is hard to see (smaller font, low contrast).
- Having them on separate rows is visually awkward — they represent a single navigation path but appear disconnected.

## Design

Merge both rows into a **single breadcrumb bar** rendered by `WorkflowLayout`. The bar shows the full navigation path from the workflow root down to the currently displayed item.

### Behavior by route

| Route | Breadcrumb content |
|---|---|
| `/workflows/:workflowId` | **WorkflowName** (highlighted, no link — it's the current view) |
| `/workflows/:workflowId/steps/:uuid` | WorkflowName `>` AncestorStep `>` ... `>` **CurrentStep** (highlighted) |

The last item is always highlighted (e.g., `color: #e2e8f0`, no link) because it represents the currently displayed view. All preceding items are links (`color: #60a5fa`).

### Separator

Items are separated by a `>` character in `color: #475569`, consistent with the current step breadcrumb style.

---

## Component Changes

### `workflowStore.ts` — Add breadcrumb state

Add new state to the Zustand store:

```ts
// New state
stepBreadcrumbs: Array<{ uuid: string; name: string }>;
setStepBreadcrumbs: (crumbs: Array<{ uuid: string; name: string }>) => void;
```

Default value: `[]` (empty array, meaning no step is selected — we're at the workflow level).

### `WorkflowLayout.tsx` — Render the unified breadcrumb

Replace the current `<nav>` that renders only the workflow name link. The new `<nav>` reads `stepBreadcrumbs` from the Zustand store and renders the full path.

**Rendering logic:**

```
const stepBreadcrumbs = useWorkflowStore((s) => s.stepBreadcrumbs);
const isAtWorkflowLevel = stepBreadcrumbs.length === 0;
```

1. **Workflow name item:**
   - If `isAtWorkflowLevel`: render as plain text, highlighted (`color: #e2e8f0`).
   - Otherwise: render as a `<Link>` to `/workflows/:workflowId` (`color: #60a5fa`).

2. **Step breadcrumb items** (from `stepBreadcrumbs`):
   - For each item except the last: render a `>` separator followed by a `<Link>` to `/workflows/:workflowId/steps/:uuid`.
   - For the last item: render a `>` separator followed by plain highlighted text (`color: #e2e8f0`).

The `<nav>` keeps the same styling as the current workflow breadcrumb row: `padding: 0.5rem 1.25rem`, `fontSize: 0.85rem`, `borderBottom: 1px solid #1e293b`, `flexWrap: wrap`.

### `StepView.tsx` — Set breadcrumbs in store, remove local breadcrumb nav

Two changes:

1. **On step detail load**: call `setStepBreadcrumbs(breadcrumbs)` from the Zustand store with the `breadcrumbs` array returned by the step detail API. This should happen in a `useEffect` that runs when `data` changes.

2. **Remove** the entire `<nav>` block that currently renders step breadcrumbs (lines 65–97 in the current file). The breadcrumb rendering is now handled by `WorkflowLayout`.

### `WorkflowView.tsx` — Clear breadcrumbs on mount

Add a `useEffect` that calls `setStepBreadcrumbs([])` on mount. This ensures that when the user navigates back to the workflow-level view (either via the breadcrumb link or browser back), the breadcrumb bar resets to show only the workflow name as the highlighted current item.

```ts
const setStepBreadcrumbs = useWorkflowStore((s) => s.setStepBreadcrumbs);

useEffect(() => {
  setStepBreadcrumbs([]);
}, [setStepBreadcrumbs]);
```

---

## Data Flow

```
StepView mounts
  → fetches step detail (includes breadcrumbs array)
  → useEffect calls setStepBreadcrumbs(breadcrumbs)
  → Zustand store updates
  → WorkflowLayout re-renders breadcrumb bar with full path

User clicks workflow name in breadcrumb
  → navigates to /workflows/:workflowId
  → WorkflowView mounts
  → useEffect calls setStepBreadcrumbs([])
  → breadcrumb bar shows only workflow name (highlighted)

User clicks ancestor step in breadcrumb
  → navigates to /workflows/:workflowId/steps/:ancestorUuid
  → StepView re-mounts with new uuid
  → fetches new step detail with its own breadcrumbs
  → useEffect calls setStepBreadcrumbs(newBreadcrumbs)
  → breadcrumb bar updates to show path to the ancestor step
```

---

## No API Changes

The step detail API already returns a `breadcrumbs` array of `{ uuid, name }` objects. No backend changes are needed.

---

## Design Doc Updates

After implementation, update `design.md`:

- **Component Tree**: Remove "step breadcrumbs (inline nav in StepView)". Change "workflow name breadcrumb (inline nav in WorkflowLayout)" to "unified breadcrumb bar (inline nav in WorkflowLayout)".
- **WorkflowLayout spec**: Describe the unified breadcrumb bar that reads `stepBreadcrumbs` from the Zustand store and renders the full workflow-to-step path.
- **StepView spec**: Remove the breadcrumb rendering paragraph. Note that `StepView` sets `stepBreadcrumbs` in the Zustand store on load.
- **WorkflowView spec**: Note that it clears `stepBreadcrumbs` on mount.
- **Zustand store spec**: Add `stepBreadcrumbs` and `setStepBreadcrumbs` to the state list.
- **Breadcrumb Navigation Flow**: Update to describe the single unified bar instead of two layers.
