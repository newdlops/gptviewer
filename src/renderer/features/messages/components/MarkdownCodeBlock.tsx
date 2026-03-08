import {
  HTMLAttributes,
  memo,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ThemeMode } from '../../../types/chat';
import { autoAdjustedViewportStore } from '../lib/markdownCodeBlockState';
import {
  formatCodeLanguageLabel,
  hasRenderableMermaidContent,
  isMermaidLanguage,
  isSvgLanguage,
} from '../lib/markdownCodeBlockUtils';
import { useMarkdownCodeBlockRendering } from '../lib/useMarkdownCodeBlockRendering';
import { useMermaidDraftPreview } from '../lib/useMermaidDraftPreview';
import { useZoomableDiagramViewport } from '../lib/useZoomableDiagramViewport';
import { MarkdownCodeSourcePanel } from './MarkdownCodeSourcePanel';

function MarkdownCodeBlockComponent({
  children,
  className,
  persistenceKey,
  renderNonce = 0,
  sharedCacheScope,
  themeMode,
  ...props
}: HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
  persistenceKey: string;
  renderNonce?: number;
  sharedCacheScope?: string;
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
  const {
    clearCustomMermaidSource,
    codeOverflow,
    customMermaidSource,
    hasCustomMermaidSource,
    isRendering,
    renderError,
    renderIssue,
    renderedMarkup,
    saveCustomMermaidSource,
    scopedPersistenceKey,
    transformedMermaidLabel,
    transformedMermaidSource,
    viewMode,
    viewportContentKey,
    setViewMode,
  } = useMarkdownCodeBlockRendering({
    code,
    codeBlockRef,
    codeContentRef,
    isRenderableBlock,
    isSvgBlock,
    language,
    persistenceKey,
    renderNonce,
    sharedCacheScope,
    themeMode,
  });
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
  const [customMermaidDraft, setCustomMermaidDraft] = useState('');
  const {
    isPreviewRendering,
    previewError,
    previewMarkup,
  } = useMermaidDraftPreview({
    enabled: isMermaidBlock && viewMode !== 'rendered',
    source: customMermaidDraft,
    themeMode,
  });
  const shouldShowTransformedMermaidSource =
    isMermaidBlock &&
    !!transformedMermaidSource &&
    transformedMermaidSource.trim() !== code.trim();
  const hasOverflowIndicator = isRenderedView ? hasOverflow : codeOverflow;
  const issueBadgeLabel = useMemo(() => {
    if (!renderIssue) {
      return '';
    }

    if (renderIssue.source === 'original') {
      return '원본 오류';
    }

    if (renderIssue.source === 'custom') {
      return '사용자 오류';
    }

    return renderIssue.severity === 'warning' ? '변환 경고' : '변환 오류';
  }, [renderIssue]);
  const issueDescription = useMemo(() => {
    if (!renderIssue) {
      return '';
    }

    const sourceLabel =
      renderIssue.source === 'original'
        ? '원본 Mermaid'
        : renderIssue.source === 'custom'
          ? '사용자 Mermaid'
          : '자동 변환 Mermaid';

    return `${sourceLabel}: ${renderIssue.message}`;
  }, [renderIssue]);
  const customMermaidSeed = useMemo(
    () => customMermaidSource || transformedMermaidSource || code,
    [code, customMermaidSource, transformedMermaidSource],
  );

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

  useEffect(() => {
    setCustomMermaidDraft(customMermaidSeed);
  }, [customMermaidSeed, persistenceKey]);

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
          {renderIssue ? (
            <span
              className={`code-block__issue-badge code-block__issue-badge--${renderIssue.severity}`}
            >
              {issueBadgeLabel}
            </span>
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
          {renderIssue ? (
            <div
              className={`code-block__issue-panel code-block__issue-panel--${renderIssue.severity}`}
            >
              {issueDescription}
            </div>
          ) : null}
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
          {renderIssue ? (
            <div
              className={`code-block__issue-panel code-block__issue-panel--${renderIssue.severity}`}
            >
              {issueDescription}
            </div>
          ) : null}
          {isMermaidBlock ? (
            <div className="code-block__source-compare">
              <MarkdownCodeSourcePanel
                language={language || 'text'}
                themeMode={themeMode}
                title="원본 Mermaid"
                value={code}
              />
              {shouldShowTransformedMermaidSource ? (
                <MarkdownCodeSourcePanel
                  language={language || 'text'}
                  themeMode={themeMode}
                  title={
                    transformedMermaidLabel
                      ? `${transformedMermaidLabel} 수정 Mermaid`
                      : '수정 Mermaid'
                  }
                  value={transformedMermaidSource}
                />
              ) : null}
              <MarkdownCodeSourcePanel
                actions={
                  <>
                    <button
                      className="code-block__action-button"
                      type="button"
                      onClick={() => {
                        saveCustomMermaidSource(customMermaidDraft);
                        setViewMode('rendered');
                      }}
                    >
                      캐시에 저장 후 렌더
                    </button>
                    <button
                      className="code-block__action-button"
                      type="button"
                      onClick={() => {
                        clearCustomMermaidSource();
                        setCustomMermaidDraft(
                          transformedMermaidSource || code,
                        );
                        setViewMode('rendered');
                      }}
                    >
                      사용자 코드 초기화
                    </button>
                  </>
                }
                editable
                language={language || 'text'}
                onChange={setCustomMermaidDraft}
                preview={
                  <div className="code-block__source-preview">
                    <div className="code-block__source-preview-title">미리보기</div>
                    {isPreviewRendering ? (
                      <p className="code-block__status">미리보기 렌더링 중입니다...</p>
                    ) : previewError ? (
                      <p className="code-block__status code-block__status--error">
                        {previewError}
                      </p>
                    ) : previewMarkup ? (
                      <div className="code-block__source-preview-frame">
                        <div
                          className="code-block__source-preview-content"
                          dangerouslySetInnerHTML={{ __html: previewMarkup }}
                        />
                      </div>
                    ) : (
                      <p className="code-block__status">미리보기를 표시할 코드가 없습니다.</p>
                    )}
                  </div>
                }
                themeMode={themeMode}
                title={
                  hasCustomMermaidSource
                    ? '사용자 직접 수정 Mermaid (사용 중)'
                    : '사용자 직접 수정 Mermaid'
                }
                value={customMermaidDraft}
              />
            </div>
          ) : (
            <MarkdownCodeSourcePanel
              language={language || 'text'}
              themeMode={themeMode}
              title=""
              value={code}
            />
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
    previousProps.sharedCacheScope === nextProps.sharedCacheScope &&
    previousProps.themeMode === nextProps.themeMode &&
    String(previousProps.children ?? '') === String(nextProps.children ?? ''),
);
