import {
  buildNestedWrappedRootSubgraphLines,
  buildWrappedSubgraphSpacerLines,
  mermaidPatterns,
  type MermaidEdge,
} from './mermaidVariantShared';
import {
  buildInlineMermaidChainFromDefinitions,
  buildOrderedSccChain,
} from './mermaidWrappedGraph';

export const buildGlobalWrappedSubgraphLines = (
  lines: string[],
  startIndex: number,
  globalEdges: MermaidEdge[],
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
  if (
    bodyLines.some(
      (line) =>
        mermaidPatterns.subgraph.test(line) || mermaidPatterns.end.test(line),
    )
  ) {
    return null;
  }

  const nodeDefinitions = new Map<string, string>();
  const passthroughLines: string[] = [];

  for (const rawLine of bodyLines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) {
      passthroughLines.push(rawLine);
      continue;
    }

    if (trimmedLine.startsWith('direction ')) {
      continue;
    }

    const nodeMatch = rawLine.match(mermaidPatterns.nodeLine);
    if (nodeMatch) {
      nodeDefinitions.set(nodeMatch[1], trimmedLine);
      continue;
    }

    passthroughLines.push(rawLine);
  }

  const nodeIds = Array.from(nodeDefinitions.keys());
  if (nodeIds.length < 6) {
    return null;
  }

  const nodeIdSet = new Set(nodeIds);
  const inducedEdges = globalEdges.filter(
    (edge) => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to),
  );
  if (inducedEdges.length < nodeIds.length - 1) {
    return null;
  }

  const orderedComponents = buildOrderedSccChain(nodeIds, inducedEdges);
  if (!orderedComponents) {
    return null;
  }

  wrapCounterRef.current += 1;
  const wrapCounter = wrapCounterRef.current;
  const rowCount = forcedRowCount && forcedRowCount > 1 ? forcedRowCount : 2;
  const chunkComponentCount = Math.max(
    2,
    Math.ceil(orderedComponents.length / rowCount),
  );
  const replacementLines: string[] = [];
  const skipLineIndexes = new Set<number>();
  let previousRowId: string | null = null;
  let previousLastNode: string | null = null;

  inducedEdges.forEach((edge) => {
    skipLineIndexes.add(edge.lineIndex);
  });

  for (const passthroughLine of passthroughLines) {
    replacementLines.push(`${indent}${passthroughLine.trim()}`);
  }

  for (
    let componentIndex = 0, rowIndex = 0;
    componentIndex < orderedComponents.length;
    componentIndex += chunkComponentCount, rowIndex += 1
  ) {
    const chunkComponents = orderedComponents.slice(
      componentIndex,
      componentIndex + chunkComponentCount,
    );
    const rootRowId = `gptviewerDagWrapRoot_${wrapCounter}_${rowIndex + 1}`;
    const rowId = `gptviewerDagWrap_${wrapCounter}_${rowIndex + 1}`;
    const rowComponentEdges = inducedEdges.filter((edge) => {
      const fromIndex = orderedComponents.findIndex((component) =>
        component.includes(edge.from),
      );
      const toIndex = orderedComponents.findIndex((component) =>
        component.includes(edge.to),
      );
      return (
        fromIndex >= componentIndex &&
        fromIndex < componentIndex + chunkComponents.length &&
        toIndex >= componentIndex &&
        toIndex < componentIndex + chunkComponents.length
      );
    });
    const rowNodes = chunkComponents.flat();
    const inlineRowChain = buildInlineMermaidChainFromDefinitions(
      rowNodes,
      nodeDefinitions,
      rowComponentEdges,
    );
    const rowBodyLines =
      inlineRowChain !== null
        ? [inlineRowChain]
        : [
            ...rowNodes.map((nodeId) => nodeDefinitions.get(nodeId) ?? nodeId),
            ...rowComponentEdges.map((edge) => edge.line),
          ];

    replacementLines.push(
      ...buildNestedWrappedRootSubgraphLines(
        indent,
        rootRowId,
        rowId,
        rowIndex === 0 ? header : ' ',
        rowBodyLines,
      ),
    );

    if (previousRowId) {
      const spacerId = `gptviewerDagSpacer_${wrapCounter}_${rowIndex}`;
      replacementLines.push(
        ...buildWrappedSubgraphSpacerLines(
          indent,
          previousRowId,
          rootRowId,
          spacerId,
        ),
      );

      if (previousLastNode) {
        const firstNode = rowNodes[0];
        const bridgeArrow =
          inducedEdges.find(
            (edge) => edge.from === previousLastNode && edge.to === firstNode,
          )?.arrow ?? '-->';
        replacementLines.push(
          `${indent}${previousLastNode} ${bridgeArrow} ${firstNode}`,
        );
      }
    }

    previousRowId = rootRowId;
    previousLastNode = rowNodes[rowNodes.length - 1];
  }

  return { endIndex, replacementLines, skipLineIndexes };
};
