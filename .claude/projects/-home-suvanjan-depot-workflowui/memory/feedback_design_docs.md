---
name: Design docs describe current state only
description: Don't add planned/future components to existing design docs — keep them in the feature-specific design doc until implemented
type: feedback
---

Don't add things to existing design docs (like ui/design.md) that don't exist yet. Planned components, routes, and component tree additions belong in the feature-specific design doc (e.g., docs/advanced-search.md) until they are actually implemented.

**Why:** Existing design docs should accurately describe what is currently built. Mixing in planned work creates confusion about what exists vs. what is proposed.

**How to apply:** When writing a new feature design, keep all new routes, components, and architecture in the feature's own design doc. Only update the existing design docs (ui/design.md, workflow-server/design.md, design.md) when the feature is actually implemented.
