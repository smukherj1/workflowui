# Product Requirements Document: CI/CD Workflow UI

## 1. Product Overview
A web-based user interface designed to visualize, inspect, and debug CI/CD workflows. The tool allows users to upload a JSON file containing an execution trace of a workflow, enabling deep-dive capabilities into hierarchical steps, dependency graphs, logs, and performance metrics.

## 2. Core Concepts
* **Workflow**: A hierarchical collection of execution steps.
* **Step**: An individual unit of work. Steps can have nested sub-steps.
* **Dependency**: A step can depend on other steps.
  * *Constraint*: Dependencies can only exist between steps at the *same hierarchy level*.
  * *Constraint*: The dependencies form a Directed Acyclic Graph (DAG) and are not allowed to form cycles.

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
* The user uploads a JSON file containing the details and logs of the workflow they want to view.
* *(Pending refinement: How are validation errors, such as invalid JSON or dependency cycles, handled? Should the UI show specific error boundaries?)*

### CUJ 2: Main Workflow Visualization
* Upon successful upload, the user views the top-level steps of the workflow.
* **Graph View**: Steps are visualized as a dependency graph showing nodes at the current hierarchy level.
* **Step Metadata**: Each node displays its status (passed, failed, running, etc.), elapsed time, start time, and end time.
* **Merged Log View**: The user can view a single, merged stream of logs emitted by all steps in the current view.

### CUJ 3: Deep Dive into Steps
* The user can click on a specific step to dive into it.
* **Sub-step Visualization**: The UI switches to focus only on the selected step. If it has sub-steps, they are visualized as a graph just like the main workflow, along with step status and elapsed times.
* **Scoped Logs**: The log view updates to show a merged view of logs specific to the selected step and its sub-steps.
* **Leaf Nodes**: If the step has no sub-steps, the page displays details about this specific step and a link/view to its specific logs.

### CUJ 4: Navigation
* The user can easily navigate back to the previous view using UI elements or browser history.
* The user can navigate "up" the hierarchy if they are currently deep-diving at a level below the main workflow.

