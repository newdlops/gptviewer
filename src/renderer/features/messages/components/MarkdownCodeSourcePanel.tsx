import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ThemeMode } from '../../../types/chat';

type MarkdownCodeSourcePanelProps = {
  actions?: ReactNode;
  editable?: boolean;
  language: string;
  onChange?: (value: string) => void;
  preview?: ReactNode;
  themeMode: ThemeMode;
  title?: string;
  value: string;
};

// 큰 코드 블록의 지연 렌더링을 위한 임계값
const LAZY_RENDER_THRESHOLD_LINES = 100;

export function MarkdownCodeSourcePanel({
  actions,
  editable = false,
  language,
  onChange,
  preview,
  themeMode,
  title,
  value,
}: MarkdownCodeSourcePanelProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  
  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const isLargeCode = lineCount > LAZY_RENDER_THRESHOLD_LINES;

  useEffect(() => {
    if (!isLargeCode) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' }, // 화면 근처 400px 거리에서 미리 렌더링 시작
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [isLargeCode]);

  const editorLines = useMemo(() => {
    return Array.from({ length: Math.max(1, lineCount) }, (_, index) => index + 1);
  }, [lineCount]);
  const editorLineNumbers = useMemo(
    () => editorLines.map((lineNumber) => String(lineNumber)).join('\n'),
    [editorLines],
  );

  const syncEditorScroll = (scrollTop: number, scrollLeft: number) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }

    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
  };

  return (
    <section className="code-block__source-section" ref={containerRef}>
      {title ? <div className="code-block__source-title">{title}</div> : null}
      {editable ? (
        <div
          className={`code-block__source-editor-layout${
            preview ? ' code-block__source-editor-layout--with-preview' : ''
          }`}
        >
          <div className="code-block__source-editor-pane">
            <div className="code-block__source-editor-shell code-block__source-editor">
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="code-block__source-editor-gutter"
              >
                <pre className="code-block__source-editor-gutter-content">
                  {editorLineNumbers}
                </pre>
              </div>
              <div className="code-block__source-editor-stage">
                <div
                  ref={highlightRef}
                  aria-hidden="true"
                  className="code-block__source-editor-highlight"
                >
                  {isVisible ? (
                    <SyntaxHighlighter
                      PreTag="div"
                      className="code-block__source-editor-highlight-content"
                      customStyle={{
                        background: 'transparent',
                        borderRadius: 0,
                        margin: 0,
                        minHeight: '100%',
                        padding: '14px 18px 16px',
                      }}
                      codeTagProps={{
                        style: {
                          background: 'transparent',
                          borderRadius: 0,
                          display: 'block',
                          fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
                          fontSize: '0.92rem',
                          lineHeight: '1.65',
                          minHeight: '100%',
                          padding: 0,
                        },
                      }}
                      language={language}
                      style={themeMode === 'dark' ? oneDark : oneLight}
                      wrapLongLines={false}
                    >
                      {value.length > 0 ? value : ' '}
                    </SyntaxHighlighter>
                  ) : (
                    <div className="code-block__source-editor-highlight-content" style={{ padding: '14px 18px 16px', whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '0.92rem', lineHeight: '1.65' }}>
                      {value}
                    </div>
                  )}
                </div>
                <textarea
                  aria-label={title ?? 'Code editor'}
                  className="code-block__source-editor-input"
                  onChange={(event) => onChange?.(event.target.value)}
                  onScroll={(event) =>
                    syncEditorScroll(
                      event.currentTarget.scrollTop,
                      event.currentTarget.scrollLeft,
                    )
                  }
                  spellCheck={false}
                  value={value}
                  wrap="off"
                />
              </div>
            </div>
          </div>
          {preview ? (
            <div className="code-block__source-preview-pane">{preview}</div>
          ) : null}
        </div>
      ) : (
        isVisible ? (
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
            language={language}
            style={themeMode === 'dark' ? oneDark : oneLight}
            wrapLongLines
          >
            {value}
          </SyntaxHighlighter>
        ) : (
          <div className="code-block__source-content" style={{ padding: '14px 18px 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.92rem' }}>
            {value}
          </div>
        )
      )}
      {actions ? <div className="code-block__source-actions">{actions}</div> : null}
    </section>
  );
}
