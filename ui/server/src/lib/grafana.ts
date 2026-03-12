const GRAFANA_URL = process.env.GRAFANA_URL ?? 'http://localhost:3000';

export function buildGrafanaExploreUrl(workflowId: string, stepPath: string): string {
  const escapedPath = stepPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const logql = `{workflow_id="${workflowId}",step_path=~"${escapedPath}(/.*)?"}`;

  const left = JSON.stringify({
    datasource: 'Loki',
    queries: [{ refId: 'A', expr: logql }],
    range: { from: 'now-7d', to: 'now' },
  });

  return `${GRAFANA_URL}/explore?orgId=1&left=${encodeURIComponent(left)}`;
}
