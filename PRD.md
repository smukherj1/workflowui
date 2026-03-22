# Product Requirements Document: CI/CD Workflow UI

## 1. Product Overview

A web-based user interface designed to visualize, inspect, and debug CI/CD workflows. The tool allows users to upload a JSON file containing an execution trace of a workflow, enabling deep-dive capabilities into hierarchical steps, dependency graphs, logs, and performance metrics. Users can also navigate directly to previously uploaded workflows by ID.

## 2. Core Concepts

- **Workflow**: A hierarchical collection of execution steps.
- **Step**: An individual unit of work. Steps can have nested sub-steps.
- **Dependency**: A step can depend on other steps.
  - _Constraint_: Dependencies can only exist between steps at the _same hierarchy level_.
  - _Constraint_: The dependencies form a Directed Acyclic Graph (DAG) and are not allowed to form cycles.
- **Metadata**: A standardized set of fields shared by both workflows and steps:
  - **Name** (required): A short string describing the workflow or step.
  - **URI** (optional): A string that uniquely identifies the workflow or step. For workflows, this could include the source repository location and SCM provider (e.g., `github://org/repo`). For steps, it identifies the resource being acted on (e.g., `gcs://bucket/path/to/object` for a Google Cloud Storage object). Users choose an encoding scheme that makes sense for their domain.
  - **Pin** (optional): A string identifying a unique version of the resource identified by the URI. For example, a Git commit SHA for a repository, or a digest for a container image. Can be omitted when versioning doesn't apply.
  - **Start Time** (optional): RFC 3339 timestamp in UTC when the workflow or step started execution.
  - **End Time** (optional): RFC 3339 timestamp in UTC when the workflow or step finished execution.

## 3. Example CI Workflow

1. Start of the build.
2. (Depends on 1) Analysis: Read configurations and build internal representation.
3. (Depends on 2) Fetching inputs:
   - 3.1 Fetch Github repos (parallel).
   - 3.2 Fetch Maven packages (parallel).
   - 3.3 Fetch npm packages (parallel).
4. (Depends on 3) Executing the build:
   - 4.1 Executing build command 1.
   - 4.2 (Depends on 4.1) Executing build command 2.
5. (Depends on 4) Uploading outputs:
   - 5.1 Upload docker images (parallel).
   - 5.2 Upload tarballs to S3 (parallel).
6. End of build.

## 4. Critical User Journeys (CUJs)

### CUJ 1: Upload and Initialization

- The user uploads a JSON file containing the details and logs of the workflow they want to view.
- The UI displays an error if the JSON file is invalid or had other issues
  like steps formed a cycle or too many nodes in a hierarchy level (from
  non-function requirements of the system).
- Once uploaded the user gets a link where they can view their workflow.

### CUJ 2: Landing Page Navigation

- In addition to uploading a workflow, the landing page lets the user navigate directly to a previously uploaded workflow by entering its workflow ID.
- The user can also navigate directly to a specific step by entering its step UUID.
- Invalid or expired IDs display a clear error message.

### CUJ 3: Main Workflow Visualization

- Upon successful upload, the user views the top-level steps of the workflow.
- **Information Card**: A dedicated card at the top shows the workflow's metadata — name, URI, pin, start and end times (in local timezone), and duration. Only fields that were provided in the uploaded data are shown.
- **Graph View**: Steps are visualized as a dependency graph showing nodes at the current hierarchy level.
- **Step Metadata**: Each node displays its status (passed, failed, running, etc.), elapsed time, start time, and end time.
- **Logs Link**: The user can navigate to a dedicated full-page log viewer showing a merged stream of logs from all steps at the current level.

### CUJ 4: Deep Dive into Steps

- The user can click on a specific step to dive into it.
- **Information Card**: A dedicated card shows the step's metadata — name, URI, pin, start and end times (in local timezone), and duration.
- **Sub-step Visualization**: If the step has sub-steps, they are visualized as a graph just like the main workflow, along with step status and elapsed times.
- **Logs Link**: The step view provides a link to a dedicated full-page log viewer showing a merged view of logs for the selected step and its sub-steps.
- **Leaf Nodes**: If the step has no sub-steps, the page displays details about this specific step and a link to its specific logs in the dedicated log viewer.

### CUJ 5: Dedicated Log Viewer

- The user navigates to a full-page log view from the workflow or step view.
- Logs are displayed in a full-viewport area with monospace formatting.
- The viewer shows one page of log lines at a time with navigation controls to move between pages, avoiding the performance issues of loading all logs into a single scrolling container.
- A text filter allows narrowing down the displayed lines.

### CUJ 6: Navigation

- A persistent navigation element lets the user return to the home / landing page from any view.
- The user can easily navigate back to the previous view using UI elements or browser history.
- The user can navigate "up" the hierarchy if they are currently deep-diving at a level below the main workflow.

## 5. Non-Functional Requirements

- An uploaded workflow is retained for at least 7 days.

- Limits on the structure of a workflow:
  - Each hierarchy level can have at most 10000 steps.
  - Each step can depend on at most a 100 other steps.
  - There can be at most 10 hierarchy levels.
  - The logs for a step with no sub-steps can be at most 10 MB.
  - The total amount of logs for an entire workflow can be at most 50 MB.
