import {
  HTMLAttributes,
  memo,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import mermaid from 'mermaid';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ThemeMode } from '../../../types/chat';
import { queueMermaidRenderTask } from '../lib/mermaidRenderQueue';
import { useZoomableDiagramViewport } from '../lib/useZoomableDiagramViewport';

type RenderViewMode = 'auto' | 'code' | 'rendered';

const renderViewModeStore = new Map<string, RenderViewMode>();
const renderedMarkupStore = new Map<string, string>();
const transformedMermaidSourceStore = new Map<string, string>();
const transformedMermaidLabelStore = new Map<string, string>();
const autoAdjustedViewportStore = new Map<string, string>();

const formatCodeLanguageLabel = (value?: string): string => {
  const normalizedValue = (value || '').trim().toLowerCase();

  if (!normalizedValue) {
    return 'TEXT';
  }

  const aliases: Record<string, string> = {
    bash: 'BASH',
    cpp: 'C++',
    csharp: 'C#',
    html: 'HTML',
    javascript: 'JavaScript',
    js: 'JavaScript',
    json: 'JSON',
    jsx: 'JSX',
    markdown: 'Markdown',
    md: 'Markdown',
    python: 'Python',
    py: 'Python',
    shell: 'Shell',
    sh: 'Shell',
    sql: 'SQL',
    text: 'TEXT',
    ts: 'TypeScript',
    tsx: 'TSX',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
    yml: 'YAML',
  };

  return aliases[normalizedValue] || normalizedValue.toUpperCase();
};

const getNormalizedCodeLanguage = (value?: string): string =>
  (value || '').trim().toLowerCase();

const MERMAID_LOADING_TEXT_PATTERN =
  /^(?:mermaid\s*)?(?:다이어그램\s*)?불러오는 중(?:\.{3}|…)?$/i;
const HTTP_HEADER_CODE_PATTERN =
  /^https?:\/\/|^httphttp\/1\.[01]\s+\d{3}|^http\/1\.[01]\s+\d{3}/i;
const MERMAID_HORIZONTAL_DIRECTION_PATTERN =
  /^(\s*(?:flowchart|graph)\s+)(LR|RL)\b/im;
const MERMAID_DIRECTION_STATEMENT_PATTERN = /^(\s*direction\s+)(LR|RL)\b/im;
const MERMAID_DIRECTION_STATEMENT_GLOBAL_PATTERN =
  /^(\s*direction\s+)(LR|RL)\b/gim;
const MERMAID_SIMPLE_CHAIN_ARROW_PATTERN =
  /\s*(-->|->|==>|=>|-.->|==|---|~~~)\s*/g;
const MERMAID_SUBGRAPH_PATTERN = /^(\s*)subgraph\s+(.+)$/i;
const MERMAID_END_PATTERN = /^(\s*)end\s*$/i;
const MERMAID_NODE_LINE_PATTERN =
  /^\s*([A-Za-z0-9_]+)\s*(?:\[\[.*\]\]|\[.*\]|\(\(.*\)\)|\(\(?.*\)?\)|\{.*\}|>".*"<|>".*")\s*$/;
const MERMAID_EDGE_LINE_PATTERN =
  /^\s*([A-Za-z0-9_]+)\s*(-->|->|==>|=>|-.->|==|---|~~~)\s*([A-Za-z0-9_]+)\s*$/;

type MermaidEdge = {
  arrow: string;
  from: string;
  lineIndex: number;
  line: string;
  to: string;
};

const getPreferredWrapRowCount = (itemCount: number) => {
  if (itemCount <= 16) {
    return 2;
  }

  if (itemCount <= 30) {
    return 3;
  }

  return Math.min(Math.max(Math.ceil(itemCount / 10), 3), 5);
};

const getPreferredWrapChunkSize = (itemCount: number) =>
  Math.max(3, Math.ceil(itemCount / getPreferredWrapRowCount(itemCount)));

const buildWrappedRowHeaderLabel = (header: string, rowIndex: number) => {
  if (rowIndex !== 0) {
    return '[" "]';
  }

  const trimmedHeader = header.trim();
  const bracketLabelMatch = trimmedHeader.match(/^[A-Za-z0-9_]+\s*(\[[\s\S]+\])$/);
  if (bracketLabelMatch) {
    return bracketLabelMatch[1];
  }

  if (trimmedHeader.startsWith('[')) {
    return trimmedHeader;
  }

  if (trimmedHeader.startsWith('"') && trimmedHeader.endsWith('"')) {
    return `[${trimmedHeader}]`;
  }

  const quotedHeader = trimmedHeader.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `["${quotedHeader}"]`;
};

const hasRenderableMermaidContent = (value?: string): boolean => {
  const normalizedValue = (value || '').trim();
  if (
    !normalizedValue ||
    MERMAID_LOADING_TEXT_PATTERN.test(normalizedValue) ||
    HTTP_HEADER_CODE_PATTERN.test(normalizedValue)
  ) {
    return false;
  }

  return (
    /(^|\n)\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta)\b/.test(
      normalizedValue,
    ) ||
    normalizedValue.includes('-->') ||
    normalizedValue.includes('subgraph')
  );
};

const isMermaidLanguage = (value?: string): boolean =>
  getNormalizedCodeLanguage(value) === 'mermaid';

const rebuildMermaidChain = (nodes: string[], arrows: string[]) => {
  let nextLine = nodes[0];

  for (let index = 0; index < arrows.length; index += 1) {
    nextLine += ` ${arrows[index]} ${nodes[index + 1]}`;
  }

  return nextLine;
};

const parseSimpleMermaidChain = (line: string) => {
  const trimmedLine = line.trim();
  if (
    !trimmedLine ||
    trimmedLine.startsWith('%%') ||
    trimmedLine.startsWith('subgraph ') ||
    trimmedLine === 'end' ||
    trimmedLine.startsWith('direction ') ||
    trimmedLine.startsWith('style ') ||
    trimmedLine.startsWith('class ') ||
    trimmedLine.startsWith('classDef ') ||
    trimmedLine.startsWith('linkStyle ') ||
    trimmedLine.startsWith('click ') ||
    trimmedLine.includes('|')
  ) {
    return null;
  }

  const matches = Array.from(trimmedLine.matchAll(MERMAID_SIMPLE_CHAIN_ARROW_PATTERN));
  if (matches.length < 4) {
    return null;
  }

  const arrows = matches.map((match) => match[1]);
  const nodes: string[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    const node = trimmedLine.slice(lastIndex, match.index).trim();
    if (!node) {
      return null;
    }
    nodes.push(node);
    lastIndex = match.index + match[0].length;
  }

  const lastNode = trimmedLine.slice(lastIndex).trim();
  if (!lastNode) {
    return null;
  }
  nodes.push(lastNode);

  if (nodes.length < 6) {
    return null;
  }

  return { arrows, nodes };
};

const collectGlobalMermaidEdges = (lines: string[]): MermaidEdge[] =>
  lines.flatMap((line, lineIndex) => {
    const parsedChain = parseSimpleMermaidChain(line);
    if (parsedChain) {
      return parsedChain.arrows.map((arrow, index) => ({
        arrow,
        from: parsedChain.nodes[index],
        line: `${parsedChain.nodes[index]} ${arrow} ${parsedChain.nodes[index + 1]}`,
        lineIndex,
        to: parsedChain.nodes[index + 1],
      }));
    }

    const edgeMatch = line.match(MERMAID_EDGE_LINE_PATTERN);
    if (!edgeMatch) {
      return [];
    }

    return [
      {
        arrow: edgeMatch[2],
        from: edgeMatch[1],
        line: line.trim(),
        lineIndex,
        to: edgeMatch[3],
      },
    ];
  });

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

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const stackNodeId = stack.pop();
      if (!stackNodeId) {
        break;
      }

      onStack.delete(stackNodeId);
      component.push(stackNodeId);
      if (stackNodeId === nodeId) {
        break;
      }
    }
    components.push(component);
  };

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return components;
};

const buildOrderedSccChain = (
  nodeIds: string[],
  edges: MermaidEdge[],
) => {
  const outgoing = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, new Set());
  }

  for (const edge of edges) {
    outgoing.get(edge.from)?.add(edge.to);
  }

  const components = computeTarjanScc(nodeIds, outgoing);
  if (components.length < 2) {
    return null;
  }

  const componentByNode = new Map<string, number>();
  components.forEach((component, index) => {
    component.forEach((nodeId) => componentByNode.set(nodeId, index));
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
    const fromComponent = componentByNode.get(edge.from);
    const toComponent = componentByNode.get(edge.to);
    if (
      fromComponent === undefined ||
      toComponent === undefined ||
      fromComponent === toComponent
    ) {
      continue;
    }

    const targets = componentOutgoing.get(fromComponent);
    if (!targets || targets.has(toComponent)) {
      continue;
    }

    targets.add(toComponent);
    outdegree.set(fromComponent, (outdegree.get(fromComponent) ?? 0) + 1);
    indegree.set(toComponent, (indegree.get(toComponent) ?? 0) + 1);
  }

  const startComponents = components
    .map((_, index) => index)
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
    currentComponent =
      nextComponents.length === 1 ? nextComponents[0] : undefined;
  }

  if (visited.size !== components.length) {
    return null;
  }

  return orderedComponents;
};

const buildInlineMermaidChainFromDefinitions = (
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

const buildGlobalWrappedSubgraphLines = (
  lines: string[],
  startIndex: number,
  globalEdges: MermaidEdge[],
  wrapCounterRef: { current: number },
) => {
  const subgraphMatch = lines[startIndex].match(MERMAID_SUBGRAPH_PATTERN);
  if (!subgraphMatch) {
    return null;
  }

  let depth = 0;
  let endIndex = -1;

  for (let index = startIndex; index < lines.length; index += 1) {
    if (MERMAID_SUBGRAPH_PATTERN.test(lines[index])) {
      depth += 1;
    } else if (MERMAID_END_PATTERN.test(lines[index])) {
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
        MERMAID_SUBGRAPH_PATTERN.test(line) || MERMAID_END_PATTERN.test(line),
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

    const nodeMatch = rawLine.match(MERMAID_NODE_LINE_PATTERN);
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
  const rowCount = getPreferredWrapRowCount(orderedComponents.length);
  const chunkComponentCount = Math.max(
    2,
    Math.ceil(orderedComponents.length / rowCount),
  );
  const replacementLines: string[] = [];
  const skipLineIndexes = new Set<number>();
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

    replacementLines.push(
      `${indent}subgraph ${rowId}${buildWrappedRowHeaderLabel(header, rowIndex)}`,
    );
    replacementLines.push(`${indent}  direction LR`);

    if (inlineRowChain) {
      replacementLines.push(`${indent}  ${inlineRowChain}`);
    } else {
      for (const nodeId of rowNodes) {
        replacementLines.push(
          `${indent}  ${nodeDefinitions.get(nodeId) ?? nodeId}`,
        );
      }

      for (const edge of rowComponentEdges) {
        replacementLines.push(`${indent}  ${edge.line}`);
      }
    }

    replacementLines.push(`${indent}end`);
    replacementLines.push(
      `${indent}  style ${rowId} fill:transparent,stroke:transparent`,
    );

    if (previousLastNode) {
      const firstNode = rowNodes[0];
      const bridgeArrow =
        inducedEdges.find(
          (edge) => edge.from === previousLastNode && edge.to === firstNode,
        )?.arrow ?? '-->';
      replacementLines.push(
        `${indent}  ${previousLastNode} ${bridgeArrow} ${firstNode}`,
      );
    }

    previousLastNode = rowNodes[rowNodes.length - 1];
  }

  return { endIndex, replacementLines, skipLineIndexes };
};

const buildWrappedSubgraphLines = (
  lines: string[],
  startIndex: number,
  wrapCounterRef: { current: number },
) => {
  const subgraphMatch = lines[startIndex].match(MERMAID_SUBGRAPH_PATTERN);
  if (!subgraphMatch) {
    return null;
  }

  let depth = 0;
  let endIndex = -1;

  for (let index = startIndex; index < lines.length; index += 1) {
    if (MERMAID_SUBGRAPH_PATTERN.test(lines[index])) {
      depth += 1;
    } else if (MERMAID_END_PATTERN.test(lines[index])) {
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

    if (MERMAID_SUBGRAPH_PATTERN.test(rawLine) || MERMAID_END_PATTERN.test(rawLine)) {
      return null;
    }

    const nodeMatch = rawLine.match(MERMAID_NODE_LINE_PATTERN);
    if (nodeMatch) {
      nodeDefinitions.set(nodeMatch[1], trimmedLine);
      indegree.set(nodeMatch[1], indegree.get(nodeMatch[1]) ?? 0);
      outdegree.set(nodeMatch[1], outdegree.get(nodeMatch[1]) ?? 0);
      continue;
    }

    const edgeMatch = rawLine.match(MERMAID_EDGE_LINE_PATTERN);
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
    (nodeId) => (indegree.get(nodeId) ?? 0) === 0 && (outdegree.get(nodeId) ?? 0) === 1,
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
  const wrapperId = `gptviewerWrapGroup_${wrapCounter}`;
  const chunkNodeCount = getPreferredWrapChunkSize(orderedNodes.length);
  const replacementLines: string[] = [];
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
    const rowId = `${wrapperId}_${chunkIndex + 1}`;

    replacementLines.push(
      `${indent}subgraph ${rowId}${buildWrappedRowHeaderLabel(header, chunkIndex)}`,
    );
    replacementLines.push(`${indent}  direction LR`);
    for (const nodeId of chunkNodes) {
      const definition = nodeDefinitions.get(nodeId);
      replacementLines.push(`${indent}  ${definition ?? nodeId}`);
    }
    for (let edgeIndex = 0; edgeIndex < chunkArrows.length; edgeIndex += 1) {
      replacementLines.push(
        `${indent}  ${chunkNodes[edgeIndex]} ${chunkArrows[edgeIndex]} ${chunkNodes[edgeIndex + 1]}`,
      );
    }
    replacementLines.push(`${indent}end`);
    replacementLines.push(
      `${indent}  style ${rowId} fill:transparent,stroke:transparent`,
    );

    if (previousLastNode) {
      replacementLines.push(
        `${indent}  ${previousLastNode} ${orderedArrows[startNodeIndex - 1]} ${chunkNodes[0]}`,
      );
    }

    previousLastNode = chunkNodes[chunkNodes.length - 1];
  }

  return { endIndex, replacementLines };
};

const buildVerticalMermaidVariant = (value: string): string | null => {
  let nextValue = value;
  let hasChanged = false;

  if (MERMAID_HORIZONTAL_DIRECTION_PATTERN.test(nextValue)) {
    nextValue = nextValue.replace(MERMAID_HORIZONTAL_DIRECTION_PATTERN, '$1TB');
    hasChanged = true;
  }

  if (MERMAID_DIRECTION_STATEMENT_PATTERN.test(nextValue)) {
    nextValue = nextValue.replace(
      MERMAID_DIRECTION_STATEMENT_GLOBAL_PATTERN,
      '$1TB',
    );
    hasChanged = true;
  }

  return hasChanged ? nextValue : null;
};

const buildWrappedMermaidVariant = (value: string): string | null => {
  const baseValue = buildVerticalMermaidVariant(value) ?? value;
  const lines = baseValue.split('\n');
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
    const chunkNodeCount = getPreferredWrapChunkSize(parsedChain.nodes.length);
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

const readMermaidSvgSize = (svgMarkup: string) => {
  const viewBoxMatch = svgMarkup.match(
    /viewBox=["'][^"']*\s([\d.]+)\s([\d.]+)["']/i,
  );
  if (viewBoxMatch) {
    const width = Number.parseFloat(viewBoxMatch[1]);
    const height = Number.parseFloat(viewBoxMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { height, width };
    }
  }

  const widthMatch = svgMarkup.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
  const heightMatch = svgMarkup.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
  if (widthMatch && heightMatch) {
    const width = Number.parseFloat(widthMatch[1]);
    const height = Number.parseFloat(heightMatch[1]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { height, width };
    }
  }

  return null;
};

const shouldPreferVerticalMermaidLayout = (
  defaultMarkup: string,
  verticalMarkup: string,
  availableWidth?: number,
) => {
  const defaultSize = readMermaidSvgSize(defaultMarkup);
  const verticalSize = readMermaidSvgSize(verticalMarkup);

  if (!defaultSize || !verticalSize) {
    return false;
  }

  const defaultAspect = defaultSize.width / defaultSize.height;
  const verticalAspect = verticalSize.width / verticalSize.height;
  const widthReduction = verticalSize.width / defaultSize.width;
  const normalizedAvailableWidth =
    availableWidth && availableWidth > 0 ? availableWidth : null;
  const defaultOverflowsViewport = normalizedAvailableWidth
    ? defaultSize.width > normalizedAvailableWidth * 1.02
    : false;
  const verticalOverflowsViewport = normalizedAvailableWidth
    ? verticalSize.width > normalizedAvailableWidth * 1.02
    : false;
  const verticalClearlyNarrower = widthReduction < 0.88;
  const verticalModeratelyNarrower = widthReduction < 0.94;

  if (defaultOverflowsViewport && !verticalOverflowsViewport) {
    return true;
  }

  if (defaultOverflowsViewport && verticalClearlyNarrower) {
    return true;
  }

  return (
    (defaultAspect > 1.45 || defaultSize.width > 1400) &&
    verticalModeratelyNarrower &&
    verticalAspect < defaultAspect
  );
};

const shouldPreferWrappedMermaidLayout = (
  currentMarkup: string,
  wrappedMarkup: string,
  availableWidth?: number,
) => {
  const currentSize = readMermaidSvgSize(currentMarkup);
  const wrappedSize = readMermaidSvgSize(wrappedMarkup);

  if (!currentSize || !wrappedSize) {
    return false;
  }

  const normalizedAvailableWidth =
    availableWidth && availableWidth > 0 ? availableWidth : null;
  const currentOverflowsViewport = normalizedAvailableWidth
    ? currentSize.width > normalizedAvailableWidth * 1.02
    : false;
  const wrappedOverflowsViewport = normalizedAvailableWidth
    ? wrappedSize.width > normalizedAvailableWidth * 1.02
    : false;
  const widthReduction = wrappedSize.width / currentSize.width;
  const currentAspect = currentSize.width / currentSize.height;
  const wrappedAspect = wrappedSize.width / wrappedSize.height;

  if (currentOverflowsViewport && !wrappedOverflowsViewport) {
    return true;
  }

  if (currentOverflowsViewport && widthReduction < 1) {
    return true;
  }

  if (currentOverflowsViewport && widthReduction < 0.92) {
    return true;
  }

  return (
    currentAspect > 1.1 &&
    widthReduction < 0.98 &&
    wrappedAspect < currentAspect
  );
};

const isSvgLanguage = (value?: string, code?: string): boolean => {
  const normalizedLanguage = getNormalizedCodeLanguage(value);
  const normalizedCode = (code || '').trim().toLowerCase();

  return (
    normalizedCode.startsWith('<svg') &&
    ['svg', 'xml', 'html', 'image/svg+xml'].includes(normalizedLanguage || 'svg')
  );
};

function MarkdownCodeBlockComponent({
  children,
  className,
  persistenceKey,
  renderNonce = 0,
  themeMode,
  ...props
}: HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
  persistenceKey: string;
  renderNonce?: number;
  themeMode: ThemeMode;
}) {
  const codeBlockRef = useRef<HTMLDivElement>(null);
  const codeContentRef = useRef<HTMLDivElement>(null);
  const language = className?.match(/language-([\w-]+)/)?.[1];
  const code = String(children ?? '').replace(/\n$/, '');
  const isBlockCode = !!language || code.includes('\n');
  const isMermaidBlock =
    isMermaidLanguage(language) && hasRenderableMermaidContent(code);
  const isSvgBlock = isSvgLanguage(language, code);
  const isRenderableBlock = isMermaidBlock || isSvgBlock;
  const scopedPersistenceKey = `${persistenceKey}:render:${renderNonce}`;
  const renderCacheKey = `${themeMode}:${language || 'text'}:${code}`;
  const [viewMode, setViewMode] = useState<RenderViewMode>(
    () => renderViewModeStore.get(scopedPersistenceKey) ?? 'auto',
  );
  const [renderedMarkup, setRenderedMarkup] = useState(
    () => renderedMarkupStore.get(renderCacheKey) ?? '',
  );
  const [transformedMermaidSource, setTransformedMermaidSource] = useState(
    () => transformedMermaidSourceStore.get(renderCacheKey) ?? '',
  );
  const [transformedMermaidLabel, setTransformedMermaidLabel] = useState(
    () => transformedMermaidLabelStore.get(renderCacheKey) ?? '',
  );
  const [renderError, setRenderError] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [codeOverflow, setCodeOverflow] = useState(false);
  const blockId = useId().replace(/:/g, '-');
  const mermaidRenderCountRef = useRef(0);
  const viewportContentKey = `${renderCacheKey}:${renderedMarkup.length}`;
  const isRenderedView = isRenderableBlock && viewMode === 'rendered';
  const {
    autoAdjustViewport,
    canvasRef,
    canPan,
    contentRef,
    hasOverflow,
    isDragging,
    resetViewport,
    shellRef,
    viewportHandlers,
    viewportRef,
    zoomIn,
    zoomLabel,
    zoomOut,
  } = useZoomableDiagramViewport(
    isRenderedView && !isRendering && !renderError && !!renderedMarkup,
    viewportContentKey,
    scopedPersistenceKey,
  );
  const shouldShowTransformedMermaidSource =
    isMermaidBlock &&
    !!transformedMermaidSource &&
    transformedMermaidSource.trim() !== code.trim();
  const hasOverflowIndicator = isRenderedView ? hasOverflow : codeOverflow;
  const lastRenderNonceRef = useRef(renderNonce);

  useEffect(() => {
    if (lastRenderNonceRef.current === renderNonce) {
      return;
    }

    lastRenderNonceRef.current = renderNonce;
    renderedMarkupStore.delete(renderCacheKey);
    transformedMermaidSourceStore.delete(renderCacheKey);
    transformedMermaidLabelStore.delete(renderCacheKey);
    setRenderedMarkup('');
    setTransformedMermaidSource('');
    setTransformedMermaidLabel('');
    setRenderError('');
    setIsRendering(false);
    setViewMode('auto');
  }, [renderCacheKey, renderNonce]);

  useEffect(() => {
    setViewMode(renderViewModeStore.get(scopedPersistenceKey) ?? 'auto');
  }, [scopedPersistenceKey]);

  useEffect(() => {
    renderViewModeStore.set(scopedPersistenceKey, viewMode);
  }, [scopedPersistenceKey, viewMode]);

  useEffect(() => {
    if (!isRenderableBlock || viewMode !== 'auto') {
      return;
    }

    if (renderedMarkupStore.has(renderCacheKey)) {
      setRenderedMarkup(renderedMarkupStore.get(renderCacheKey) ?? '');
      setTransformedMermaidSource(
        transformedMermaidSourceStore.get(renderCacheKey) ?? '',
      );
      setTransformedMermaidLabel(
        transformedMermaidLabelStore.get(renderCacheKey) ?? '',
      );
      setViewMode('rendered');
      return;
    }
  }, [isRenderableBlock, renderCacheKey, viewMode]);

  useEffect(() => {
    setRenderedMarkup(renderedMarkupStore.get(renderCacheKey) ?? '');
    setTransformedMermaidSource(
      transformedMermaidSourceStore.get(renderCacheKey) ?? '',
    );
    setTransformedMermaidLabel(
      transformedMermaidLabelStore.get(renderCacheKey) ?? '',
    );
    setRenderError('');
    setIsRendering(false);
  }, [renderCacheKey]);

  useEffect(() => {
    if (isRenderedView) {
      setCodeOverflow(false);
      return;
    }

    const element = codeContentRef.current;
    if (!element) {
      return;
    }

    const measureOverflow = () => {
      if (element.clientWidth <= 1) {
        setCodeOverflow(false);
        return;
      }

      const scrollContainers = Array.from(
        element.querySelectorAll<HTMLElement>('.code-block__source-content'),
      );
      const targets = scrollContainers.length > 0 ? scrollContainers : [element];
      const nextHasOverflow = targets.some(
        (target) =>
          target.clientWidth > 1 && target.scrollWidth > target.clientWidth + 4,
      );

      setCodeOverflow(nextHasOverflow);
    };

    const frame = window.requestAnimationFrame(measureOverflow);

    const resizeObserver = new ResizeObserver(() => {
      measureOverflow();
    });

    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [code, isRenderedView, language, shouldShowTransformedMermaidSource]);

  useEffect(() => {
    if (!isRenderableBlock || viewMode === 'code') {
      return;
    }

    let isCancelled = false;
    const shouldPromoteViewMode = viewMode === 'auto';

    const renderBlock = async () => {
      const cachedMarkup = renderedMarkupStore.get(renderCacheKey);

      if (cachedMarkup) {
        if (!isCancelled) {
          setRenderedMarkup(cachedMarkup);
          setRenderError('');
          setIsRendering(false);
        }
        return;
      }

      setIsRendering(true);
      setRenderError('');

      try {
        const nextRenderResult = await queueMermaidRenderTask(
          renderCacheKey,
          async () => {
            if (isSvgBlock) {
              return {
                markup: code,
                transformedLabel: '',
                transformedSource: '',
              };
            }

            mermaid.initialize({
              securityLevel: 'loose',
              startOnLoad: false,
              theme: themeMode === 'dark' ? 'dark' : 'default',
            });

            mermaidRenderCountRef.current += 1;
            const { svg } = await mermaid.render(
              `mermaid-${blockId}-${mermaidRenderCountRef.current}`,
              code,
            );

            let preferredSvg = svg;
            let preferredSource = code;
            let preferredLabel = '';

            const verticalVariant = buildVerticalMermaidVariant(code);
            const availableRenderWidth = Math.max(
              (codeBlockRef.current?.clientWidth ?? 0) - 32,
              0,
            );

            if (verticalVariant) {
              mermaidRenderCountRef.current += 1;
              const { svg: verticalSvg } = await mermaid.render(
                `mermaid-${blockId}-${mermaidRenderCountRef.current}`,
                verticalVariant,
              );

              if (
                shouldPreferVerticalMermaidLayout(
                  preferredSvg,
                  verticalSvg,
                  availableRenderWidth,
                )
              ) {
                preferredSvg = verticalSvg;
                preferredSource = verticalVariant;
                preferredLabel = '세로 변환';
              }
            }

            const wrappedVariant = buildWrappedMermaidVariant(code);
            if (wrappedVariant) {
              mermaidRenderCountRef.current += 1;
              const { svg: wrappedSvg } = await mermaid.render(
                `mermaid-${blockId}-${mermaidRenderCountRef.current}`,
                wrappedVariant,
              );

              if (
                shouldPreferWrappedMermaidLayout(
                  preferredSvg,
                  wrappedSvg,
                  availableRenderWidth,
                )
              ) {
                preferredSvg = wrappedSvg;
                preferredSource = wrappedVariant;
                preferredLabel = '자동 줄바꿈 변환';
              }
            }

            return {
              markup: preferredSvg,
              transformedLabel: preferredLabel,
              transformedSource:
                preferredSource.trim() !== code.trim() ? preferredSource : '',
            };
          },
        );

        if (!isCancelled) {
          renderedMarkupStore.set(renderCacheKey, nextRenderResult.markup);
          if (nextRenderResult.transformedSource) {
            transformedMermaidSourceStore.set(
              renderCacheKey,
              nextRenderResult.transformedSource,
            );
            transformedMermaidLabelStore.set(
              renderCacheKey,
              nextRenderResult.transformedLabel,
            );
          } else {
            transformedMermaidSourceStore.delete(renderCacheKey);
            transformedMermaidLabelStore.delete(renderCacheKey);
          }
          setRenderedMarkup(nextRenderResult.markup);
          setTransformedMermaidSource(nextRenderResult.transformedSource);
          setTransformedMermaidLabel(nextRenderResult.transformedLabel);
          if (shouldPromoteViewMode) {
            setViewMode('rendered');
          }
        }
      } catch (error) {
        if (!isCancelled) {
          setRenderError(
            error instanceof Error
              ? error.message
              : '코드를 렌더링하지 못했습니다.',
          );
        }
      } finally {
        if (!isCancelled) {
          setIsRendering(false);
        }
      }
    };

    void renderBlock();

    return () => {
      isCancelled = true;
    };
  }, [
    blockId,
    code,
    isRenderableBlock,
    isSvgBlock,
    renderCacheKey,
    themeMode,
    viewMode,
  ]);

  useEffect(() => {
    if (
      !isRenderedView ||
      isRendering ||
      !!renderError ||
      !renderedMarkup ||
      autoAdjustedViewportStore.get(scopedPersistenceKey) === viewportContentKey
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      autoAdjustedViewportStore.set(scopedPersistenceKey, viewportContentKey);
      autoAdjustViewport();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    autoAdjustViewport,
    isRenderedView,
    isRendering,
    scopedPersistenceKey,
    renderError,
    renderedMarkup,
    viewportContentKey,
  ]);

  const renderSourcePanel = useMemo(
    () =>
      (
        title: string,
        value: string,
        panelLanguage: string,
        key: string,
      ) => (
        <section className="code-block__source-section" key={key}>
          <div className="code-block__source-title">{title}</div>
          <SyntaxHighlighter
            PreTag="div"
            className="code-block__source-content"
            customStyle={{
              background: 'transparent',
              borderRadius: 0,
              margin: 0,
              padding: '14px 18px 16px',
            }}
            codeTagProps={{
              style: {
                background: 'transparent',
                borderRadius: 0,
                fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
                fontSize: '0.92rem',
                padding: 0,
              },
            }}
            language={panelLanguage}
            style={themeMode === 'dark' ? oneDark : oneLight}
            wrapLongLines
          >
            {value}
          </SyntaxHighlighter>
        </section>
      ),
    [themeMode],
  );

  if (!isBlockCode) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className="code-block" ref={codeBlockRef}>
      <div className="code-block__header">
        <div className="code-block__header-meta">
          <span className="code-block__language">
            {formatCodeLanguageLabel(language)}
          </span>
          {hasOverflowIndicator ? (
            <span className="code-block__overflow-badge">overflow</span>
          ) : null}
        </div>
        {isRenderableBlock ? (
          <div className="code-block__actions">
            {isRenderedView && !isRendering && !renderError ? (
              <div className="code-block__zoom-controls">
                <button
                  aria-label="다이어그램 축소"
                  className="code-block__zoom-button"
                  type="button"
                  onClick={zoomOut}
                >
                  -
                </button>
                <span className="code-block__zoom-value">{zoomLabel}</span>
                <button
                  aria-label="다이어그램 확대"
                  className="code-block__zoom-button"
                  type="button"
                  onClick={zoomIn}
                >
                  +
                </button>
              </div>
            ) : null}
            {isRenderedView && !isRendering && !renderError ? (
              <>
                <button
                  className="code-block__action-button"
                  type="button"
                  onClick={resetViewport}
                >
                  맞춤
                </button>
                <button
                  className="code-block__action-button"
                  type="button"
                  onClick={autoAdjustViewport}
                >
                  자동조절
                </button>
              </>
            ) : null}
            <button
              className="code-block__action-button"
              type="button"
              onClick={() =>
                setViewMode((currentMode) =>
                  currentMode === 'code'
                    ? 'rendered'
                    : isRenderedView
                      ? 'code'
                      : 'rendered',
                )
              }
            >
              {isRenderedView ? '코드 보기' : '렌더링'}
            </button>
          </div>
        ) : null}
      </div>
      {isRenderedView ? (
        <div className="code-block__rendered">
          {isRendering ? (
            <p className="code-block__status">렌더링 중입니다...</p>
          ) : renderError ? (
            <p className="code-block__status code-block__status--error">
              {renderError}
            </p>
          ) : (
            <div className="code-block__rendered-shell" ref={shellRef}>
              <div className="code-block__rendered-frame">
                <div
                  {...viewportHandlers}
                  className={`code-block__rendered-surface${
                    canPan ? ' code-block__rendered-surface--interactive' : ''
                  }${isDragging ? ' code-block__rendered-surface--dragging' : ''}`}
                  ref={viewportRef}
                >
                  <div className="code-block__rendered-canvas" ref={canvasRef}>
                    <div
                      className="code-block__rendered-content"
                      dangerouslySetInnerHTML={{ __html: renderedMarkup }}
                      ref={contentRef}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="code-block__content" ref={codeContentRef}>
          {shouldShowTransformedMermaidSource ? (
            <div className="code-block__source-compare">
              {renderSourcePanel(
                '원본 Mermaid',
                code,
                language || 'text',
                'original',
              )}
              {renderSourcePanel(
                transformedMermaidLabel
                  ? `${transformedMermaidLabel} 수정 Mermaid`
                  : '수정 Mermaid',
                transformedMermaidSource,
                language || 'text',
                'transformed',
              )}
            </div>
          ) : (
            <SyntaxHighlighter
              PreTag="div"
              className="code-block__source-content"
              customStyle={{
                background: 'transparent',
                borderRadius: 0,
                margin: 0,
                padding: '16px 18px 18px',
              }}
              codeTagProps={{
                style: {
                  background: 'transparent',
                  borderRadius: 0,
                  fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
                  fontSize: '0.92rem',
                  padding: 0,
                },
              }}
              language={language || 'text'}
              style={themeMode === 'dark' ? oneDark : oneLight}
              wrapLongLines
            >
              {code}
            </SyntaxHighlighter>
          )}
        </div>
      )}
    </div>
  );
}

export const MarkdownCodeBlock = memo(
  MarkdownCodeBlockComponent,
  (previousProps, nextProps) =>
    previousProps.className === nextProps.className &&
    previousProps.persistenceKey === nextProps.persistenceKey &&
    previousProps.renderNonce === nextProps.renderNonce &&
    previousProps.themeMode === nextProps.themeMode &&
    String(previousProps.children ?? '') === String(nextProps.children ?? ''),
);
