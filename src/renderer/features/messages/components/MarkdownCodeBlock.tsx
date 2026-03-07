import {
  HTMLAttributes,
  ReactNode,
  useEffect,
  useId,
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

type RenderViewMode = 'auto' | 'code' | 'rendered';

const renderViewModeStore = new Map<string, RenderViewMode>();
const renderedMarkupStore = new Map<string, string>();

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

const isMermaidLanguage = (value?: string): boolean =>
  getNormalizedCodeLanguage(value) === 'mermaid';

const isSvgLanguage = (value?: string, code?: string): boolean => {
  const normalizedLanguage = getNormalizedCodeLanguage(value);
  const normalizedCode = (code || '').trim().toLowerCase();

  return (
    normalizedCode.startsWith('<svg') &&
    ['svg', 'xml', 'html', 'image/svg+xml'].includes(normalizedLanguage || 'svg')
  );
};

export function MarkdownCodeBlock({
  children,
  className,
  persistenceKey,
  themeMode,
  ...props
}: HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
  persistenceKey: string;
  themeMode: ThemeMode;
}) {
  const language = className?.match(/language-([\w-]+)/)?.[1];
  const code = String(children ?? '').replace(/\n$/, '');
  const isBlockCode = !!language || code.includes('\n');
  const isMermaidBlock = isMermaidLanguage(language);
  const isSvgBlock = isSvgLanguage(language, code);
  const isRenderableBlock = isMermaidBlock || isSvgBlock;
  const [viewMode, setViewMode] = useState<RenderViewMode>(
    () => renderViewModeStore.get(persistenceKey) ?? 'auto',
  );
  const [renderedMarkup, setRenderedMarkup] = useState(
    () => renderedMarkupStore.get(`${themeMode}:${language || 'text'}:${code}`) ?? '',
  );
  const [renderError, setRenderError] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const blockId = useId().replace(/:/g, '-');
  const mermaidRenderCountRef = useRef(0);
  const renderCacheKey = `${themeMode}:${language || 'text'}:${code}`;
  const latestRenderCacheKeyRef = useRef(renderCacheKey);
  const isRenderedView = isRenderableBlock && viewMode === 'rendered';

  useEffect(() => {
    setViewMode(renderViewModeStore.get(persistenceKey) ?? 'auto');
  }, [persistenceKey]);

  useEffect(() => {
    renderViewModeStore.set(persistenceKey, viewMode);
  }, [persistenceKey, viewMode]);

  useEffect(() => {
    if (!isRenderableBlock || viewMode !== 'auto') {
      return;
    }

    if (renderedMarkupStore.has(renderCacheKey)) {
      setRenderedMarkup(renderedMarkupStore.get(renderCacheKey) ?? '');
      setViewMode('rendered');
      return;
    }
  }, [isRenderableBlock, renderCacheKey, viewMode]);

  useEffect(() => {
    if (latestRenderCacheKeyRef.current === renderCacheKey) {
      return;
    }

    latestRenderCacheKeyRef.current = renderCacheKey;
    setRenderedMarkup(renderedMarkupStore.get(renderCacheKey) ?? '');
    setRenderError('');
    setIsRendering(false);
  }, [renderCacheKey]);

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
        const nextMarkup = await queueMermaidRenderTask(
          renderCacheKey,
          async () => {
            if (isSvgBlock) {
              return code;
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

            return svg;
          },
        );

        if (!isCancelled) {
          renderedMarkupStore.set(renderCacheKey, nextMarkup);
          setRenderedMarkup(nextMarkup);
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

  if (!isBlockCode) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__language">
          {formatCodeLanguageLabel(language)}
        </span>
        {isRenderableBlock ? (
          <button
            className="code-block__toggle"
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
            <div
              className="code-block__rendered-surface"
              dangerouslySetInnerHTML={{ __html: renderedMarkup }}
            />
          )}
        </div>
      ) : (
        <SyntaxHighlighter
          PreTag="div"
          className="code-block__content"
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
  );
}
