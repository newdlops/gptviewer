import {
  buildNestedWrappedRootSubgraphLines,
  buildWrappedSubgraphSpacerLines,
  collectGlobalMermaidEdges,
  collectTopLevelSubgraphBlocks,
} from './mermaidVariantShared';

export const buildIndependentTopLevelSubgraphVariant = (
  value: string,
): string | null => {
  const lines = value.split('\n');
  const topLevelBlocks = collectTopLevelSubgraphBlocks(lines);
  if (topLevelBlocks.length < 2) {
    return null;
  }

  const blockIndexByNode = new Map<string, number>();
  for (let blockIndex = 0; blockIndex < topLevelBlocks.length; blockIndex += 1) {
    for (const nodeId of topLevelBlocks[blockIndex].nodeIds) {
      if (blockIndexByNode.has(nodeId)) {
        return null;
      }
      blockIndexByNode.set(nodeId, blockIndex);
    }
  }

  const globalEdges = collectGlobalMermaidEdges(lines);
  for (const edge of globalEdges) {
    const fromBlock = blockIndexByNode.get(edge.from);
    const toBlock = blockIndexByNode.get(edge.to);
    if (
      fromBlock !== undefined &&
      toBlock !== undefined &&
      fromBlock !== toBlock
    ) {
      return null;
    }
  }

  const rebuiltLines: string[] = [];
  const topLevelIds: string[] = [];
  const blockByStartIndex = new Map(
    topLevelBlocks.map((block) => [block.startIndex, block]),
  );

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const block = blockByStartIndex.get(lineIndex);
    if (!block) {
      rebuiltLines.push(lines[lineIndex]);
      continue;
    }

    const rootId = `gptviewerTopLevelWrap_${topLevelIds.length + 1}`;
    const childId = `${rootId}_child`;
    rebuiltLines.push(
      ...buildNestedWrappedRootSubgraphLines(
        block.indent,
        rootId,
        childId,
        block.header,
        block.bodyLines,
      ),
    );
    topLevelIds.push(rootId);
    lineIndex = block.endIndex;
  }

  const indent = topLevelBlocks[0]?.indent ?? '';
  topLevelIds.forEach((subgraphId, blockIndex) => {
    if (blockIndex === 0) {
      return;
    }

    const previousId = topLevelIds[blockIndex - 1];
    const spacerId = `gptviewerTopLevelSpacer_${blockIndex}`;
    rebuiltLines.push(
      ...buildWrappedSubgraphSpacerLines(indent, previousId, subgraphId, spacerId),
    );
  });

  return rebuiltLines.join('\n');
};

export const buildCompactedTopLevelSubgraphVariant = (
  value: string,
): string | null => {
  const lines = value.split('\n');
  const topLevelBlocks = collectTopLevelSubgraphBlocks(lines);
  if (topLevelBlocks.length < 2) {
    return null;
  }

  const rebuiltLines: string[] = [];
  const topLevelIds: string[] = [];
  const blockByStartIndex = new Map(
    topLevelBlocks.map((block) => [block.startIndex, block]),
  );

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const block = blockByStartIndex.get(lineIndex);
    if (!block) {
      rebuiltLines.push(lines[lineIndex]);
      continue;
    }

    const rootId = `gptviewerTopLevelCompact_${topLevelIds.length + 1}`;
    const childId = `${rootId}_child`;
    rebuiltLines.push(
      ...buildNestedWrappedRootSubgraphLines(
        block.indent,
        rootId,
        childId,
        block.header,
        block.bodyLines,
      ),
    );
    topLevelIds.push(rootId);
    lineIndex = block.endIndex;
  }

  const indent = topLevelBlocks[0]?.indent ?? '';
  topLevelIds.forEach((subgraphId, blockIndex) => {
    if (blockIndex === 0) {
      return;
    }

    const previousId = topLevelIds[blockIndex - 1];
    const spacerId = `gptviewerTopLevelCompactSpacer_${blockIndex}`;
    rebuiltLines.push(
      ...buildWrappedSubgraphSpacerLines(indent, previousId, subgraphId, spacerId),
    );
  });

  return rebuiltLines.join('\n');
};
