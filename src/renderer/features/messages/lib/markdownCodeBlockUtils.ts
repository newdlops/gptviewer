const MERMAID_LOADING_TEXT_PATTERN =
  /^(?:mermaid\s*)?(?:다이어그램\s*)?불러오는 중(?:\.{3}|…)?$/i;
const HTTP_HEADER_CODE_PATTERN =
  /^https?:\/\/|^httphttp\/1\.[01]\s+\d{3}|^http\/1\.[01]\s+\d{3}/i;

export const formatCodeLanguageLabel = (value?: string): string => {
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

export const getNormalizedCodeLanguage = (value?: string): string =>
  (value || '').trim().toLowerCase();

export const hasRenderableMermaidContent = (value?: string): boolean => {
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

export const isMermaidLanguage = (value?: string): boolean =>
  getNormalizedCodeLanguage(value) === 'mermaid';

export const isSvgLanguage = (value?: string, code?: string): boolean => {
  const normalizedLanguage = getNormalizedCodeLanguage(value);
  const normalizedCode = (code || '').trim().toLowerCase();

  return (
    normalizedCode.startsWith('<svg') &&
    ['svg', 'xml', 'html', 'image/svg+xml'].includes(normalizedLanguage || 'svg')
  );
};
