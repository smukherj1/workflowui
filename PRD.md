UI to view CI/CD workflows with the ability to deep dive into workflow
logs and performance issues.

A CI/CD workflow could have a large hierarchy of steps with inter-dependencies.
e.g., assume a CI workflow that builds a source repository. It may have the
following workflow:

1. Start of the build.
2. (Depends on 1) Analysis where the build configuration files are read and transformed into
   an internal representation of the build system that defines what inputs to
   fetch, how to set up and execute the build commands and where to upload
   outputs.
3. (Depends on 2) Fetching the inputs of the build.
   3.1 One or more sub-steps to fetch source code from Github repositories. Fetching
   of each individual repository can be done in parallel but is only started after
   step 3 itself has started.
   3.2 One or more sub-steps to fetch Maven packages. Similar to Github repositories,
   fetching each maven package can be done in parallel with other maven package and
   Github repository fetching but is only started after step 3 itself has started.
   3.3 One or more sub-steps to fetch npm packages.
   ... and so on ...
4. (Depends on 3) Executing the build.
   4.1 Executing build command 1.
   4.2 (Dependens on 4.1) Executing build command 2.
   ... and so on ...
5. (Depends on 4) Uploading outputs of the build.
   5.1 One or more sub-steps to upload docker images to Github Packages. Uploading each
   individual package can be done in paralle but is only started after
   step 5 itself has started.
   5.2 One or more sub-steps to upload binary distribution tarballs to Amazon AWS S3
   buckets. Similar, each tarball upload can be in parallel with all other sub-steps
   under 5.
   ... and so on ...
6. End of build.

Dependencies can only exist between steps at the same hierarchy level. e.g., Step 2
can depend on 1. But Step 3.1 can't depend on Step 2 because they're at different
hierarchy levels.

The dependencies are not allowed to form cycles.

# Critical User Journeys

- Allow users to upload a JSON file containing the details about logs about the workflow
  the user would like to view.

- User can then view their uploaded workflow. The workflow steps are visualized as a graph
  which shows the nodes at the next hierarchy level and their dependencies. The step
  status (passed vs failed) is shown along with the elapsed times, start time, end time, etc.
  The user should also be view the logs emitted by all the steps in a single view. e.g, each
  step could have its own logs but viewing the workflow's logs should merge the logs from the
  individual steps into a merged view.

- User can click on a workflow step to dive into it. The UI should then switching to view only
  that step. Visualizing a step should be almost the same as viewing the entire workflow. The
  step should show its sub-steps, their status, elapsed times, etc. The user should be view to
  view the logs from that step that is a merged view of the logs from the individual steps. If
  the step has no sub-step, the page should only show the details about this step and a link
  it the logs from that step.

- The user should be able to easily navigate back to the previous page. The user should also be
  able to navigate up the hierarchy if they're currently at a level below the main workflow.
