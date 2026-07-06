import { theme } from '../ui/theme.js';

export interface TaskNode {
  id: string;
  name: string;
  dependencies: string[];
  estimatedDuration?: number;
  priority?: number;
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed';
}

export interface TaskGraph {
  nodes: TaskNode[];
  edges: Array<{ from: string; to: string }>;
}

export interface ScheduleResult {
  order: string[][];
  criticalPath: string[];
  estimatedDuration: number;
}

export class DependencyScheduler {
  buildGraph(tasks: TaskNode[]): TaskGraph {
    const nodes = tasks.map((task) => ({
      ...task,
      dependencies: [...task.dependencies],
      status: task.status,
    }));
    const ids = new Set<string>();

    for (const node of nodes) {
      if (!node.id.trim()) throw new Error('task id is required');
      if (ids.has(node.id)) throw new Error(`duplicate task id: ${node.id}`);
      ids.add(node.id);
    }

    for (const node of nodes) {
      for (const dependency of node.dependencies) {
        if (!ids.has(dependency)) {
          throw new Error(`unknown dependency ${dependency} for task ${node.id}`);
        }
      }
    }

    const edges = nodes.flatMap((node) =>
      node.dependencies.map((dependency) => ({ from: dependency, to: node.id })),
    );
    const graph = { nodes, edges };
    this.getReady(graph);
    return graph;
  }

  schedule(graph: TaskGraph): ScheduleResult {
    const cycles = this.detectCycles(graph);
    if (cycles.length > 0) {
      throw new Error(`dependency cycle detected: ${cycles[0]?.join(' -> ')}`);
    }

    const simulation = this.cloneGraph(graph);
    const order: string[][] = [];
    let estimatedDuration = 0;

    while (simulation.nodes.some((node) => !isTerminal(node.status))) {
      const ready = this.getReady(simulation).filter((node) => node.status === 'ready');
      if (ready.length === 0) break;

      const batch = ready.sort(compareTasks).map((node) => node.id);
      order.push(batch);
      estimatedDuration += Math.max(
        ...ready.map((node) => normalizeDuration(node.estimatedDuration)),
      );

      for (const taskId of batch) {
        this.markComplete(simulation, taskId);
      }
    }

    return {
      order,
      criticalPath: this.getCriticalPath(graph),
      estimatedDuration,
    };
  }

  getReady(graph: TaskGraph): TaskNode[] {
    const ready = graph.nodes.filter((node) => {
      if (node.status === 'done' || node.status === 'failed') return false;
      const dependenciesDone = node.dependencies.every((dependency) => {
        const upstream = graph.nodes.find((candidate) => candidate.id === dependency);
        return upstream?.status === 'done';
      });

      if (dependenciesDone && node.status === 'pending') {
        node.status = 'ready';
      }
      return dependenciesDone && node.status === 'ready';
    });

    return ready.sort(compareTasks);
  }

  markComplete(graph: TaskGraph, taskId: string): TaskGraph {
    const task = graph.nodes.find((node) => node.id === taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    task.status = 'done';
    this.getReady(graph);
    return graph;
  }

  markFailed(graph: TaskGraph, taskId: string): TaskGraph {
    const dependents = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = dependents.get(edge.from) ?? [];
      list.push(edge.to);
      dependents.set(edge.from, list);
    }

    const queue = [taskId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const node = graph.nodes.find((candidate) => candidate.id === current);
      if (!node || node.status === 'done') continue;
      node.status = 'failed';

      for (const downstream of dependents.get(current) ?? []) {
        queue.push(downstream);
      }
    }

    return graph;
  }

  getCriticalPath(graph: TaskGraph): string[] {
    const cycles = this.detectCycles(graph);
    if (cycles.length > 0) return [];

    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const predecessors = new Map<string, string[]>();
    const indegree = new Map<string, number>();

    for (const node of graph.nodes) {
      predecessors.set(node.id, []);
      indegree.set(node.id, 0);
    }

    for (const edge of graph.edges) {
      predecessors.get(edge.to)?.push(edge.from);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }

    const queue = graph.nodes
      .filter((node) => (indegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id);
    const topo: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      topo.push(current);
      for (const edge of graph.edges.filter((candidate) => candidate.from === current)) {
        const nextCount = (indegree.get(edge.to) ?? 0) - 1;
        indegree.set(edge.to, nextCount);
        if (nextCount === 0) queue.push(edge.to);
      }
    }

    const distance = new Map<string, number>();
    const parent = new Map<string, string | undefined>();

    for (const taskId of topo) {
      const node = nodesById.get(taskId);
      if (!node) continue;
      const ownDuration = normalizeDuration(node.estimatedDuration);
      const previous = predecessors.get(taskId) ?? [];

      if (previous.length === 0) {
        distance.set(taskId, ownDuration);
        parent.set(taskId, undefined);
        continue;
      }

      let bestParent: string | undefined;
      let bestDistance = 0;
      for (const upstream of previous) {
        const candidate = distance.get(upstream) ?? 0;
        if (candidate > bestDistance) {
          bestDistance = candidate;
          bestParent = upstream;
        }
      }

      distance.set(taskId, bestDistance + ownDuration);
      parent.set(taskId, bestParent);
    }

    let endTask: string | undefined;
    let longest = 0;
    for (const [taskId, total] of distance.entries()) {
      if (total > longest) {
        longest = total;
        endTask = taskId;
      }
    }

    const path: string[] = [];
    while (endTask) {
      path.unshift(endTask);
      endTask = parent.get(endTask);
    }

    return path;
  }

  detectCycles(graph: TaskGraph): string[][] {
    const adjacency = new Map<string, string[]>();
    for (const node of graph.nodes) adjacency.set(node.id, []);
    for (const edge of graph.edges) adjacency.get(edge.from)?.push(edge.to);

    const visited = new Set<string>();
    const active = new Set<string>();
    const stack: string[] = [];
    const cycles: string[][] = [];
    const seenCycles = new Set<string>();

    const visit = (nodeId: string) => {
      visited.add(nodeId);
      active.add(nodeId);
      stack.push(nodeId);

      for (const next of adjacency.get(nodeId) ?? []) {
        if (!visited.has(next)) {
          visit(next);
          continue;
        }

        if (active.has(next)) {
          const start = stack.lastIndexOf(next);
          const cycle = [...stack.slice(start), next];
          const key = cycle.join('>');
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push(cycle);
          }
        }
      }

      stack.pop();
      active.delete(nodeId);
    };

    for (const node of graph.nodes) {
      if (!visited.has(node.id)) visit(node.id);
    }

    return cycles;
  }

  private cloneGraph(graph: TaskGraph): TaskGraph {
    return {
      nodes: graph.nodes.map((node) => ({
        ...node,
        dependencies: [...node.dependencies],
      })),
      edges: graph.edges.map((edge) => ({ ...edge })),
    };
  }
}

export function formatSchedule(result: ScheduleResult): string {
  const lines = [
    `${theme.badge('SCHEDULE')} ${theme.assistant(`~${result.estimatedDuration} units`)}`,
    `${theme.dim('batches:')}`,
    ...result.order.map(
      (batch, index) => `  ${theme.hl(`batch ${index + 1}`)} ${batch.join(', ')}`,
    ),
    `${theme.dim('critical path:')} ${result.criticalPath.join(' -> ') || 'none'}`,
  ];
  return lines.join('\n');
}

function compareTasks(left: TaskNode, right: TaskNode): number {
  return (
    (right.priority ?? 0) - (left.priority ?? 0) ||
    normalizeDuration(left.estimatedDuration) - normalizeDuration(right.estimatedDuration) ||
    left.id.localeCompare(right.id)
  );
}

function normalizeDuration(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function isTerminal(status: TaskNode['status']): boolean {
  return status === 'done' || status === 'failed';
}
