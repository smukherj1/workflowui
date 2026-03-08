UI to inspect CI/CD workflows that have multiple steps forming a Directed Acyclic Graph.
The UI allows viewing:

- The status (success vs failure) of the overall workflow and the various steps.
- How long the workflow and the various steps took.
- Diving deeper into the workflow to debug the source of failures or performance
  issues as necessary. A workflow can be comprised of a hierarchy of steps and
  sub steps. A step can have thousands of sub-steps. The UI allows interactively
  diving deeper into the hierarchy to inspect logs or visualize the performance
  of steps.
- The visualization of the workflow performance is presented as an interactive
  profiling graph.

- 
