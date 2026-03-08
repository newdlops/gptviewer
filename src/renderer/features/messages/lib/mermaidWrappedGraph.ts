import type { MermaidEdge } from './mermaidVariantShared';

const computeTarjanScc = (
  nodeIds: string[],
  outgoing: Map<string, Set<string>>,
) => {
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  const strongConnect = (nodeId: string) => {
    indexByNode.set(nodeId, nextIndex);
    lowLinkByNode.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const neighborId of outgoing.get(nodeId) ?? []) {
      if (!indexByNode.has(neighborId)) {
        strongConnect(neighborId);
        lowLinkByNode.set(
          nodeId,
          Math.min(
            lowLinkByNode.get(nodeId) ?? Number.POSITIVE_INFINITY,
            lowLinkByNode.get(neighborId) ?? Number.POSITIVE_INFINITY,
          ),
        );
      } else if (onStack.has(neighborId)) {
        lowLinkByNode.set(
          nodeId,
          Math.min(
            lowLinkByNode.get(nodeId) ?? Number.POSITIVE_INFINITY,
            indexByNode.get(neighborId) ?? Number.POSITIVE_INFINITY,
          ),
        );
      }
    }

    if (lowLinkByNode.get(nodeId) === indexByNode.get(nodeId)) {
      const component: string[] = [];

      while (stack.length > 0) {
        const nextNodeId = stack.pop();
        if (!nextNodeId) {
          break;
        }

        onStack.delete(nextNodeId);
        component.push(nextNodeId);
        if (nextNodeId === nodeId) {
          break;
        }
      }

      components.push(component);
    }
  };

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return components.reverse();
};

export const buildOrderedSccChain = (
  nodeIds: string[],
  edges: MermaidEdge[],
) => {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, new Set());
    incoming.set(nodeId, new Set());
  }

  for (const edge of edges) {
    outgoing.get(edge.from)?.add(edge.to);
    incoming.get(edge.to)?.add(edge.from);
  }

  const components = computeTarjanScc(nodeIds, outgoing);
  if (components.length < 2) {
    return null;
  }

  const componentIndexByNode = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) =>
      componentIndexByNode.set(nodeId, componentIndex),
    );
  });

  const componentOutgoing = new Map<number, Set<number>>();
  const indegree = new Map<number, number>();
  const outdegree = new Map<number, number>();

  for (let index = 0; index < components.length; index += 1) {
    componentOutgoing.set(index, new Set());
    indegree.set(index, 0);
    outdegree.set(index, 0);
  }

  for (const edge of edges) {
    const fromComponent = componentIndexByNode.get(edge.from);
    const toComponent = componentIndexByNode.get(edge.to);
    if (
      fromComponent === undefined ||
      toComponent === undefined ||
      fromComponent === toComponent
    ) {
      continue;
    }

    if (!componentOutgoing.get(fromComponent)?.has(toComponent)) {
      componentOutgoing.get(fromComponent)?.add(toComponent);
      outdegree.set(fromComponent, (outdegree.get(fromComponent) ?? 0) + 1);
      indegree.set(toComponent, (indegree.get(toComponent) ?? 0) + 1);
    }
  }

  const startComponents = Array.from(indegree.keys())
    .sort((left, right) => left - right)
    .filter((index) => (indegree.get(index) ?? 0) === 0);

  if (startComponents.length !== 1) {
    return null;
  }

  for (let index = 0; index < components.length; index += 1) {
    if ((indegree.get(index) ?? 0) > 1 || (outdegree.get(index) ?? 0) > 1) {
      return null;
    }
  }

  const orderedComponents: string[][] = [];
  const visited = new Set<number>();
  let currentComponent = startComponents[0];

  while (currentComponent !== undefined) {
    if (visited.has(currentComponent)) {
      return null;
    }

    visited.add(currentComponent);
    orderedComponents.push(components[currentComponent]);
    const nextComponents = Array.from(
      componentOutgoing.get(currentComponent) ?? [],
    );
    currentComponent = nextComponents.length === 1 ? nextComponents[0] : undefined;
  }

  if (visited.size !== components.length) {
    return null;
  }

  return orderedComponents;
};

export const buildInlineMermaidChainFromDefinitions = (
  nodeIds: string[],
  definitions: Map<string, string>,
  edges: MermaidEdge[],
) => {
  if (nodeIds.length < 2 || edges.length !== nodeIds.length - 1) {
    return null;
  }

  const edgeByPair = new Map<string, string>();
  for (const edge of edges) {
    edgeByPair.set(`${edge.from}->${edge.to}`, edge.arrow);
  }

  let chain = definitions.get(nodeIds[0]) ?? nodeIds[0];
  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    const from = nodeIds[index];
    const to = nodeIds[index + 1];
    const arrow = edgeByPair.get(`${from}->${to}`);
    if (!arrow) {
      return null;
    }
    chain += ` ${arrow} ${definitions.get(to) ?? to}`;
  }

  return chain;
};
