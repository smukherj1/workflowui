import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
  Position,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import type { Step, Dependency } from "../lib/types";
import StepNode from "./StepNode";

const nodeTypes = { stepNode: StepNode };

const NODE_WIDTH = 220;
const NODE_HEIGHT = 70;

function buildDagreLayout(steps: Step[], dependencies: Dependency[], parentPath: string) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });

  for (const step of steps) {
    g.setNode(step.uuid, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const dep of dependencies) {
    g.setEdge(dep.from, dep.to);
  }

  dagre.layout(g);

  const nodes: Node[] = steps.map((step) => {
    const pos = g.node(step.uuid);
    const hierarchyPath = parentPath ? `${parentPath}/${step.stepId}` : `/${step.stepId}`;
    return {
      id: step.uuid,
      type: "stepNode",
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      data: { ...step, hierarchyPath },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });

  const edges: Edge[] = dependencies.map((dep) => {
    const target = steps.find((s) => s.uuid === dep.to);
    const isFailed = target?.status === "failed";
    return {
      id: `${dep.from}-${dep.to}`,
      source: dep.from,
      target: dep.to,
      style: { stroke: isFailed ? "#ef4444" : "#475569", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: isFailed ? "#ef4444" : "#475569" },
      animated: target?.status === "running",
    };
  });

  return { nodes, edges };
}

interface Props {
  steps: Step[];
  dependencies: Dependency[];
  parentPath: string;
}

export default function GraphView({ steps, dependencies, parentPath }: Props) {
  const { nodes, edges } = useMemo(
    () => buildDagreLayout(steps, dependencies, parentPath),
    [steps, dependencies, parentPath],
  );

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const step = node.data as Step;
            const colors: Record<string, string> = {
              passed: "#22c55e",
              failed: "#ef4444",
              running: "#3b82f6",
              skipped: "#9ca3af",
              cancelled: "#eab308",
            };
            return colors[step.status] ?? "#475569";
          }}
          style={{ background: "#0f172a" }}
        />
      </ReactFlow>
    </div>
  );
}
