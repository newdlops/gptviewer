import {
  collectGlobalMermaidEdges,
  getChunkSizeForRowCount,
  mermaidPatterns,
  parseSimpleMermaidChain,
  rebuildMermaidChain,
} from './mermaidVariantShared';
import { buildGlobalWrappedSubgraphLines } from './mermaidWrappedGlobalSubgraphs';
import { buildWrappedSubgraphLines } from './mermaidWrappedLinearSubgraphs';

export const buildVerticalMermaidVariant = (value: string): string | null => {
  let nextValue = value;
  let hasChanged = false;

  if (mermaidPatterns.horizontalDirection.test(nextValue)) {
    nextValue = nextValue.replace(mermaidPatterns.horizontalDirection, '$1TB');
    hasChanged = true;
  }

  if (mermaidPatterns.directionStatement.test(nextValue)) {
    nextValue = nextValue.replace(
      mermaidPatterns.directionStatementGlobal,
      '$1TB',
    );
    hasChanged = true;
  }

  return hasChanged ? nextValue : null;
};

export const buildWrappedMermaidVariant = (
  value: string,
  forcedRowCount?: number,
): string | null => {
  const lines = value.split('\n');
  const globalEdges = collectGlobalMermaidEdges(lines);
  const nextLines: string[] = [];
  const skippedLineIndexes = new Set<number>();
  let hasChanged = false;
  const wrapCounterRef = { current: 0 };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (skippedLineIndexes.has(lineIndex)) {
      continue;
    }

    const wrappedGlobalSubgraph = buildGlobalWrappedSubgraphLines(
      lines,
      lineIndex,
      globalEdges,
      wrapCounterRef,
      forcedRowCount,
    );
    if (wrappedGlobalSubgraph) {
      nextLines.push(...wrappedGlobalSubgraph.replacementLines);
      wrappedGlobalSubgraph.skipLineIndexes.forEach((index) =>
        skippedLineIndexes.add(index),
      );
      hasChanged = true;
      lineIndex = wrappedGlobalSubgraph.endIndex;
      continue;
    }

    const wrappedSubgraph = buildWrappedSubgraphLines(
      lines,
      lineIndex,
      wrapCounterRef,
      forcedRowCount,
    );
    if (wrappedSubgraph) {
      nextLines.push(...wrappedSubgraph.replacementLines);
      hasChanged = true;
      lineIndex = wrappedSubgraph.endIndex;
      continue;
    }

    const line = lines[lineIndex];
    const parsedChain = parseSimpleMermaidChain(line);
    if (!parsedChain) {
      nextLines.push(line);
      continue;
    }

    hasChanged = true;
    wrapCounterRef.current += 1;
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch?.[1] ?? '';
    const chunkNodeCount = getChunkSizeForRowCount(
      parsedChain.nodes.length,
      forcedRowCount,
    );
    const wrapperId = `gptviewerWrapGroup_${wrapCounterRef.current}`;
    let previousLastNode: string | null = null;

    nextLines.push(`${indent}subgraph ${wrapperId}[" "]`);
    nextLines.push(`${indent}  direction TB`);

    for (
      let startNodeIndex = 0, chunkIndex = 0;
      startNodeIndex < parsedChain.nodes.length;
      startNodeIndex += chunkNodeCount, chunkIndex += 1
    ) {
      const chunkNodes = parsedChain.nodes.slice(
        startNodeIndex,
        startNodeIndex + chunkNodeCount,
      );
      const chunkArrows = parsedChain.arrows.slice(
        startNodeIndex,
        startNodeIndex + chunkNodes.length - 1,
      );
      const rowId = `gptviewerWrap_${wrapCounterRef.current}_${chunkIndex + 1}`;

      nextLines.push(`${indent}  subgraph ${rowId}[" "]`);
      nextLines.push(`${indent}    direction LR`);
      nextLines.push(
        `${indent}    ${rebuildMermaidChain(chunkNodes, chunkArrows)}`,
      );
      nextLines.push(`${indent}  end`);
      nextLines.push(
        `${indent}  style ${rowId} fill:transparent,stroke:transparent`,
      );

      if (previousLastNode) {
        const bridgeArrow = parsedChain.arrows[startNodeIndex - 1];
        nextLines.push(
          `${indent}  ${previousLastNode} ${bridgeArrow} ${chunkNodes[0]}`,
        );
      }

      previousLastNode = chunkNodes[chunkNodes.length - 1];
    }

    nextLines.push(`${indent}end`);
    nextLines.push(
      `${indent}style ${wrapperId} fill:transparent,stroke:transparent`,
    );
  }

  return hasChanged ? nextLines.join('\n') : null;
};
