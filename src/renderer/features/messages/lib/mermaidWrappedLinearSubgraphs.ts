import {
  buildNestedWrappedRootSubgraphLines,
  buildWrappedSubgraphSpacerLines,
  getChunkSizeForRowCount,
  mermaidPatterns,
  type MermaidEdge,
} from './mermaidVariantShared';
import { buildInlineMermaidChainFromDefinitions } from './mermaidWrappedGraph';

export const buildWrappedSubgraphLines = (
  lines: string[],
  startIndex: number,
  wrapCounterRef: { current: number },
  forcedRowCount?: number,
) => {
  const subgraphMatch = lines[startIndex].match(mermaidPatterns.subgraph);
  if (!subgraphMatch) {
    return null;
  }

  let depth = 0;
  let endIndex = -1;

  for (let index = startIndex; index < lines.length; index += 1) {
    if (mermaidPatterns.subgraph.test(lines[index])) {
      depth += 1;
    } else if (mermaidPatterns.end.test(lines[index])) {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (endIndex === -1 || endIndex <= startIndex + 2) {
    return null;
  }

  const indent = subgraphMatch[1] ?? '';
  const header = subgraphMatch[2]?.trim();
  if (!header) {
    return null;
  }

  const bodyLines = lines.slice(startIndex + 1, endIndex);
  const nodeDefinitions = new Map<string, string>();
  const edgeMap = new Map<string, { arrow: string; next: string }>();
  const indegree = new Map<string, number>();
  const outdegree = new Map<string, number>();

  for (const rawLine of bodyLines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('%%')) {
      continue;
    }

    if (
      trimmedLine.startsWith('direction ') ||
      trimmedLine.startsWith('style ') ||
      trimmedLine.startsWith('class ') ||
      trimmedLine.startsWith('classDef ') ||
      trimmedLine.startsWith('linkStyle ') ||
      trimmedLine.startsWith('click ')
    ) {
      continue;
    }

    if (
      mermaidPatterns.subgraph.test(rawLine) ||
      mermaidPatterns.end.test(rawLine)
    ) {
      return null;
    }

    const nodeMatch = rawLine.match(mermaidPatterns.nodeLine);
    if (nodeMatch) {
      nodeDefinitions.set(nodeMatch[1], trimmedLine);
      indegree.set(nodeMatch[1], indegree.get(nodeMatch[1]) ?? 0);
      outdegree.set(nodeMatch[1], outdegree.get(nodeMatch[1]) ?? 0);
      continue;
    }

    const edgeMatch = rawLine.match(mermaidPatterns.edgeLine);
    if (edgeMatch) {
      const from = edgeMatch[1];
      const arrow = edgeMatch[2];
      const to = edgeMatch[3];

      if (edgeMap.has(from)) {
        return null;
      }

      edgeMap.set(from, { arrow, next: to });
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
      indegree.set(from, indegree.get(from) ?? 0);
      outdegree.set(from, (outdegree.get(from) ?? 0) + 1);
      outdegree.set(to, outdegree.get(to) ?? 0);
      continue;
    }

    return null;
  }

  const allNodeIds = Array.from(
    new Set([
      ...nodeDefinitions.keys(),
      ...edgeMap.keys(),
      ...Array.from(edgeMap.values()).map((edge) => edge.next),
    ]),
  );

  if (allNodeIds.length < 6 || edgeMap.size !== allNodeIds.length - 1) {
    return null;
  }

  const startNodes = allNodeIds.filter(
    (nodeId) =>
      (indegree.get(nodeId) ?? 0) === 0 && (outdegree.get(nodeId) ?? 0) === 1,
  );
  if (startNodes.length !== 1) {
    return null;
  }

  for (const nodeId of allNodeIds) {
    const inCount = indegree.get(nodeId) ?? 0;
    const outCount = outdegree.get(nodeId) ?? 0;
    const isStart = nodeId === startNodes[0];
    const isEnd = outCount === 0;

    if (!isStart && !isEnd && !(inCount === 1 && outCount === 1)) {
      return null;
    }

    if (isEnd && inCount !== 1) {
      return null;
    }
  }

  const orderedNodes: string[] = [];
  const orderedArrows: string[] = [];
  const visited = new Set<string>();
  let currentNode = startNodes[0];

  while (currentNode) {
    if (visited.has(currentNode)) {
      return null;
    }
    visited.add(currentNode);
    orderedNodes.push(currentNode);
    const nextEdge = edgeMap.get(currentNode);
    if (!nextEdge) {
      break;
    }
    orderedArrows.push(nextEdge.arrow);
    currentNode = nextEdge.next;
  }

  if (orderedNodes.length !== allNodeIds.length) {
    return null;
  }

  wrapCounterRef.current += 1;
  const wrapCounter = wrapCounterRef.current;
  const chunkNodeCount = getChunkSizeForRowCount(
    orderedNodes.length,
    forcedRowCount,
  );
  const replacementLines: string[] = [];
  let previousRowId: string | null = null;
  let previousLastNode: string | null = null;

  for (
    let startNodeIndex = 0, chunkIndex = 0;
    startNodeIndex < orderedNodes.length;
    startNodeIndex += chunkNodeCount, chunkIndex += 1
  ) {
    const chunkNodes = orderedNodes.slice(
      startNodeIndex,
      startNodeIndex + chunkNodeCount,
    );
    const chunkArrows = orderedArrows.slice(
      startNodeIndex,
      startNodeIndex + chunkNodes.length - 1,
    );
    const rootRowId = `gptviewerWrapRoot_${wrapCounter}_${chunkIndex + 1}`;
    const rowId = `gptviewerWrap_${wrapCounter}_${chunkIndex + 1}`;
    const rowEdges: MermaidEdge[] = chunkArrows.map((arrow, edgeIndex) => ({
      arrow,
      from: chunkNodes[edgeIndex],
      line: `${chunkNodes[edgeIndex]} ${arrow} ${chunkNodes[edgeIndex + 1]}`,
      lineIndex: -1,
      to: chunkNodes[edgeIndex + 1],
    }));
    const inlineRowChain = buildInlineMermaidChainFromDefinitions(
      chunkNodes,
      nodeDefinitions,
      rowEdges,
    );

    const rowBodyLines =
      inlineRowChain !== null
        ? [inlineRowChain]
        : [
            ...chunkNodes.map((nodeId) => nodeDefinitions.get(nodeId) ?? nodeId),
            ...chunkArrows.map(
              (arrow, edgeIndex) =>
                `${chunkNodes[edgeIndex]} ${arrow} ${chunkNodes[edgeIndex + 1]}`,
            ),
          ];
    replacementLines.push(
      ...buildNestedWrappedRootSubgraphLines(
        indent,
        rootRowId,
        rowId,
        chunkIndex === 0 ? header : ' ',
        rowBodyLines,
      ),
    );

    if (previousRowId) {
      const spacerId = `gptviewerWrapSpacer_${wrapCounter}_${chunkIndex}`;
      replacementLines.push(
        ...buildWrappedSubgraphSpacerLines(
          indent,
          previousRowId,
          rootRowId,
          spacerId,
        ),
      );

      if (previousLastNode) {
        replacementLines.push(
          `${indent}${previousLastNode} ${orderedArrows[startNodeIndex - 1]} ${chunkNodes[0]}`,
        );
      }
    }

    previousRowId = rootRowId;
    previousLastNode = chunkNodes[chunkNodes.length - 1];
  }

  return { endIndex, replacementLines };
};
