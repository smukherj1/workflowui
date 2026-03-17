- The UI needs a link to let the user go to the home / landing page.
- In addition to letting the user upload a workflow JSON, the landing page should also let the user
  go to a workflow or step by ID.
- We need to standardize the metadata object between the workflow and steps. The standard metadata
  should be:
  - name- A short string describing the workflow or step.
  - URI- A string that uniquely identifies the workflow or step. For the workflow, this would
    include the source repository location and the SCM (e.g., Github or something else) the
    code is hosted on. For steps, it would be a unique identifier for the resource that's being
    fetched or uploaded to. e.g., for a Google Cloud Storage object it could be
    gcs://<bucket>/<path>/<to>/<object>. The user is free to choose an encoding scheme
    that makes sense to them.
  - Pin- A string that identifies a unique version of the resource identified by the URI.
    e.g., for Github repos, this could be the commit ID. Can be omitted if it doesn't
    make sense.
  - Start Time- RFC 3339 time in UTC when the workflow or step started.
  - End Time- RFC 3339 time in UTC when the workflow or step started.
- The UI becomes sluggish when rendering a page with a lot of steps. This is because
  the UI progressively loads all the steps in a grid view into the same page which
  makes things laggy. Instead, the UI should render one page worth of results at
  a time and let the user navigate back and forth in the pages.
- The logs panel at the bottom is too small when there's a lot of logs. Also, similar
  to the UI rendering a lot of steps, for workflows with a lot of logs, the logs
  load slowly and the UI begins to lag. Similar to steps, there should be a dedicated
  view that shows only logs. The step view should provide a link to the logs for that
  step that navigates the user to a dedicated page to view logs for that step.
- The step and workflow views needs a dedicated information card for the step/workflow currently being
  viewed including the metadata about the step/workflow such as the name, URI, pin,
  start and end times (in local timezone) and duration. Details that were not
  specified in the uploaded data should be omitted. e.g., if pin was unspecified, no
  need to show a blank pin.
- Use hono for the backend server along with zod to validate requests. The main
  advantage seems to be that it provides type safety in request and response
  handling improving the robustness of the code.
- Use drizzle ORM for the postgres db. This also provides type safety and a
  framework to manage the db schema and updates.
- Mention in the design that we use bun for the javascript / typescript runtime.
