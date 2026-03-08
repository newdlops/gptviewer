const MERMAID_SIMPLE_CHAIN_ARROW_PATTERN =
  /\s*(-->|->|==>|=>|-.->|==|---|~~~)\s*/g;
const MERMAID_SUBGRAPH_PATTERN = /^(\s*)subgraph\s+(.+)$/i;
const MERMAID_END_PATTERN = /^(\s*)end\s*$/i;
const MERMAID_NODE_LINE_PATTERN =
  /^\s*([A-Za-z0-9_]+)\s*(?:\[\[.*\]\]|\[.*\]|\(\(.*\)\)|\(\(?.*\)?\)|\{.*\}|>".*"<|>".*")\s*$/;
const MERMAID_EDGE_LINE_PATTERN =
  /^\s*([A-Za-z0-9_]+)\s*(-->|->|==>|=>|-.->|==|---|~~~)\s*([A-Za-z0-9_]+)\s*$/;

export type MermaidEdge = {
  arrow: string;
  from: string;
  lineIndex: number;
  line: string;
  to: string;
};

export type TopLevelSubgraphBlock = {
  bodyLines: string[];
  endIndex: number;
  header: string;
  indent: string;
  nodeIds: string[];
  startIndex: number;
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

export const getChunkSizeForRowCount = (itemCount: number, rowCount?: number) =>
  Math.max(
    3,
    Math.ceil(
      itemCount /
        (rowCount && rowCount > 1 ? rowCount : getPreferredWrapRowCount(itemCount)),
    ),
  );

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

export const buildWrappedSubgraphLabel = (header: string) =>
  buildWrappedRowHeaderLabel(header, 0);

export const buildNestedWrappedRootSubgraphLines = (
  indent: string,
  rootId: string,
  childId: string,
  header: string,
  bodyLines: string[],
) => {
  const nextLines = [
    `${indent}subgraph ${rootId}${buildWrappedSubgraphLabel(header)}`,
    `${indent}  direction TB`,
    `${indent}  subgraph ${childId}[" "]`,
    `${indent}    direction LR`,
  ];

  for (const rawLine of bodyLines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('direction ')) {
      continue;
    }

    nextLines.push(`${indent}    ${trimmedLine}`);
  }

  nextLines.push(`${indent}  end`);
  nextLines.push(`${indent}  style ${childId} fill:transparent`);
  nextLines.push(`${indent}end`);
  nextLines.push(`${indent}style ${rootId} fill:transparent`);
  return nextLines;
};

export const buildWrappedSubgraphSpacerLines = (
  indent: string,
  previousRowId: string,
  rowId: string,
  spacerId: string,
) => [
  `${indent}${spacerId}((" "))`,
  `${indent}style ${spacerId} fill:none,stroke:none,color:transparent`,
  `${indent}${previousRowId} ~~~ ${spacerId}`,
  `${indent}${spacerId} ~~~ ${rowId}`,
];

export const rebuildMermaidChain = (nodes: string[], arrows: string[]) => {
  let nextLine = nodes[0];

  for (let index = 0; index < arrows.length; index += 1) {
    nextLine += ` ${arrows[index]} ${nodes[index + 1]}`;
  }

  return nextLine;
};

export const parseSimpleMermaidChain = (line: string) => {
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

export const collectGlobalMermaidEdges = (lines: string[]): MermaidEdge[] =>
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

export const collectTopLevelSubgraphBlocks = (
  lines: string[],
): TopLevelSubgraphBlock[] => {
  const blocks: TopLevelSubgraphBlock[] = [];
  let depth = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const subgraphMatch = line.match(MERMAID_SUBGRAPH_PATTERN);
    if (subgraphMatch) {
      if (depth === 0) {
        const indent = subgraphMatch[1] ?? '';
        const header = subgraphMatch[2]?.trim();
        if (!header) {
          depth += 1;
          continue;
        }

        const nodeIds = new Set<string>();
        let innerDepth = 1;
        let endIndex = lineIndex;

        for (let innerIndex = lineIndex + 1; innerIndex < lines.length; innerIndex += 1) {
          const innerLine = lines[innerIndex];
          if (MERMAID_SUBGRAPH_PATTERN.test(innerLine)) {
            innerDepth += 1;
          } else if (MERMAID_END_PATTERN.test(innerLine)) {
            innerDepth -= 1;
            if (innerDepth === 0) {
              endIndex = innerIndex;
              break;
            }
          }

          const nodeMatch = innerLine.match(MERMAID_NODE_LINE_PATTERN);
          if (nodeMatch) {
            nodeIds.add(nodeMatch[1]);
          }

          const edgeMatch = innerLine.match(MERMAID_EDGE_LINE_PATTERN);
          if (edgeMatch) {
            nodeIds.add(edgeMatch[1]);
            nodeIds.add(edgeMatch[3]);
          }

          const parsedChain = parseSimpleMermaidChain(innerLine);
          if (parsedChain) {
            parsedChain.nodes.forEach((nodeId) => nodeIds.add(nodeId));
          }
        }

        blocks.push({
          bodyLines: lines.slice(lineIndex + 1, endIndex),
          endIndex,
          header,
          indent,
          nodeIds: Array.from(nodeIds),
          startIndex: lineIndex,
        });
      }

      depth += 1;
      continue;
    }

    if (MERMAID_END_PATTERN.test(line)) {
      depth = Math.max(0, depth - 1);
    }
  }

  return blocks;
};

export const mermaidPatterns = {
  end: MERMAID_END_PATTERN,
  horizontalDirection: /^(\s*(?:flowchart|graph)\s+)(LR|RL)\b/im,
  directionStatement: /^(\s*direction\s+)(LR|RL)\b/im,
  directionStatementGlobal: /^(\s*direction\s+)(LR|RL)\b/gim,
  edgeLine: MERMAID_EDGE_LINE_PATTERN,
  nodeLine: MERMAID_NODE_LINE_PATTERN,
  subgraph: MERMAID_SUBGRAPH_PATTERN,
};
