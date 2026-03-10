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

// 공통 스타일 정의
const EDITOR_COMMON_STYLES = {
  fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
  fontSize: '0.92rem',
  lineHeight: '1.65', // 정확한 행 높이 고정
  padding: '14px 18px 16px',
  scrollbarWidth: 'none' as const, // 스크롤바 숨김 (Firefox)
  msOverflowStyle: 'none' as const, // 스크롤바 숨김 (IE/Edge)
  tabSize: 4,
  fontVariantLigatures: 'none' as const,
};

// 편집기 비율 저장을 위한 로컬 스토리지 키
const EDITOR_RATIO_STORAGE_KEY = 'gptviewer-editor-ratio-v1';

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
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 편집기 너비 비율 상태 (기본 50%)
  const [editorWidthPercent, setEditorWidthPercent] = useState(() => {
    try {
      const saved = localStorage.getItem(EDITOR_RATIO_STORAGE_KEY);
      return saved ? parseFloat(saved) : 50;
    } catch {
      return 50;
    }
  });
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing || !layoutRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const layoutElement = layoutRef.current;
      if (!layoutElement) return;

      const rect = layoutElement.getBoundingClientRect();
      const newWidthPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const clampedPercent = Math.min(Math.max(newWidthPercent, 20), 80); // 20% ~ 80% 사이로 제한

      setEditorWidthPercent(clampedPercent);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(EDITOR_RATIO_STORAGE_KEY, editorWidthPercent.toString());
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, editorWidthPercent]);

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
      { rootMargin: '600px' },
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

  const syncEditorScroll = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop;
    }

    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!editable) return;
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (event.key === 'Tab') {
      event.preventDefault();
      if (start === end) {
        const newValue = value.substring(0, start) + '    ' + value.substring(end);
        onChange?.(newValue);
        window.requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 4;
          syncEditorScroll();
        });
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const upToCursor = value.substring(0, start);
      const currentLine = upToCursor.split('\n').pop() || '';
      const indentMatch = currentLine.match(/^\s*/);
      const baseIndent = indentMatch ? indentMatch[0] : '';

      const isOpeningBrace = currentLine.trim().endsWith('{');
      const extraIndent = isOpeningBrace ? '    ' : '';
      const totalIndent = baseIndent + extraIndent;

      const afterCursor = value.substring(end);
      const isClosingBraceNext = afterCursor.startsWith('}');

      let newValue;
      let newCursorPos;

      if (isOpeningBrace && isClosingBraceNext) {
        newValue = upToCursor + '\n' + totalIndent + '\n' + baseIndent + afterCursor;
        newCursorPos = start + 1 + totalIndent.length;
      } else {
        newValue = upToCursor + '\n' + totalIndent + afterCursor;
        newCursorPos = start + 1 + totalIndent.length;
      }

      onChange?.(newValue);
      window.requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = newCursorPos;
        syncEditorScroll();
      });
    } else if (['{', '[', '(', '"', "'"].includes(event.key)) {
      const pairMap: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'" };
      const closing = pairMap[event.key];
      if (start === end && closing) {
        event.preventDefault();
        const newValue = value.substring(0, start) + event.key + closing + value.substring(end);
        onChange?.(newValue);
        window.requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
        });
      }
    } else if (['}', ']', ')'].includes(event.key)) {
      if (start === end && value.substring(start, start + 1) === event.key) {
        event.preventDefault();
        window.requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
        });
      }
    }
  };

  // 텍스트 너비가 textarea 너비를 넘을 수 있으므로 하이라이트 레이어의 min-width를 보정
  const highlightWidth = textareaRef.current?.scrollWidth ?? '100%';

  return (
    <section className="code-block__source-section" ref={containerRef} style={{ width: '100%', maxWidth: '100%' }}>
      {title ? <div className="code-block__source-title">{title}</div> : null}
      {editable ? (
        <div
          ref={layoutRef}
          className={`code-block__source-editor-layout${
            preview ? ' code-block__source-editor-layout--with-preview' : ''
          }`}
          style={{
            display: 'flex',
            flexDirection: 'row',
            position: 'relative',
            width: '100%',
            alignItems: 'stretch',
            minHeight: '100px',
            cursor: isResizing ? 'col-resize' : 'default',
            userSelect: isResizing ? 'none' : 'auto',
          }}
        >
          <div className="code-block__source-editor-pane" style={{ minWidth: 0, flex: `0 0 ${editorWidthPercent}%`, display: 'flex', flexDirection: 'column' }}>
            <div className="code-block__source-editor-shell code-block__source-editor" style={{ width: '100%', flex: 1, display: 'grid', gridTemplateColumns: 'auto 1fr' }}>
              {/* ... (기존 거터 및 스테이지 내용 동일) ... */}
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="code-block__source-editor-gutter"
              >
                <pre
                  className="code-block__source-editor-gutter-content"
                  style={{
                    ...EDITOR_COMMON_STYLES,
                    paddingLeft: '10px',
                    paddingRight: '10px',
                    textAlign: 'right',
                    color: 'var(--text-muted)',
                    backgroundColor: 'transparent',
                  }}
                >
                  {editorLineNumbers}
                </pre>
              </div>
              <div className="code-block__source-editor-stage" style={{ position: 'relative', overflow: 'hidden', width: '100%' }}>
                {/* 1. 하이라이트 레이어 (배경) */}
                <div
                  ref={highlightRef}
                  aria-hidden="true"
                  className="code-block__source-editor-highlight"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    zIndex: 1,
                    width: '100%',
                  }}
                >
                  {isVisible ? (
                    <SyntaxHighlighter
                      PreTag="div"
                      className="code-block__source-editor-highlight-content"
                      customStyle={{
                        background: 'transparent',
                        backgroundColor: 'transparent',
                        borderRadius: 0,
                        margin: 0,
                        padding: EDITOR_COMMON_STYLES.padding,
                        width: highlightWidth,
                        minWidth: '100%',
                      }}
                      codeTagProps={{
                        style: {
                          ...EDITOR_COMMON_STYLES,
                          background: 'transparent',
                          backgroundColor: 'transparent',
                          padding: 0,
                          display: 'block',
                        },
                      }}
                      language={language}
                      style={themeMode === 'dark' ? oneDark : oneLight}
                      wrapLongLines={false}
                    >
                      {value.length > 0 ? value : ' '}
                    </SyntaxHighlighter>
                  ) : (
                    <div
                      style={{
                        ...EDITOR_COMMON_STYLES,
                        whiteSpace: 'pre',
                        color: 'inherit',
                        width: '100%',
                      }}
                    >
                      {value}
                    </div>
                  )}
                </div>

                {/* 2. Textarea 레이어 (최상단, 실제 상호작용 주체) */}
                <textarea
                  ref={textareaRef}
                  aria-label={title ?? 'Code editor'}
                  className="code-block__source-editor-input"
                  style={{
                    ...EDITOR_COMMON_STYLES,
                    position: 'relative',
                    zIndex: 2,
                    background: 'transparent',
                    color: 'transparent',
                    caretColor: themeMode === 'dark' ? '#fff' : '#000',
                    width: '100%',
                    height: '100%',
                    minHeight: '100px',
                    minWidth: '100%',
                    resize: 'none',
                    border: 'none',
                    outline: 'none',
                    overflow: 'hidden',
                    whiteSpace: 'pre',
                    wordBreak: 'normal',
                    display: 'block',
                    boxSizing: 'border-box',
                  }}
                  onChange={(event) => {
                    onChange?.(event.target.value);
                    syncEditorScroll();
                  }}
                  onScroll={syncEditorScroll}
                  onKeyDown={handleKeyDown}
                  spellCheck={false}
                  value={value}
                  wrap="off"
                />
              </div>
            </div>
          </div>

          {preview ? (
            <>
              {/* 드래그 조절 핸들러 */}
              <div
                onMouseDown={handleResizeStart}
                style={{
                  width: '8px',
                  margin: '0 -4px',
                  cursor: 'col-resize',
                  zIndex: 10,
                  position: 'relative',
                  backgroundColor: isResizing ? 'var(--accent)' : 'transparent',
                  transition: 'background-color 0.2s',
                }}
                title="드래그하여 너비 조절"
              />
              <div className="code-block__source-preview-pane" style={{ position: 'relative', zIndex: 3, background: 'var(--panel-bg-strong)', flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-soft)', borderTop: 'none', display: 'flex', flexDirection: 'column' }}>{preview}</div>
            </>
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
              overflow: 'visible',
            }}
            codeTagProps={{
              style: {
                ...EDITOR_COMMON_STYLES,
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
          <div
            className="code-block__source-content"
            style={{
              ...EDITOR_COMMON_STYLES,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {value}
          </div>
        )
      )}
      {actions ? <div className="code-block__source-actions">{actions}</div> : null}
    </section>
  );
}
