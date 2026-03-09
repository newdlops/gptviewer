import { useState, useMemo, useEffect, useRef, memo } from 'react';
import type { ThemeMode } from '../../../types/chat';
import { formatCodeLanguageLabel } from '../lib/markdownCodeBlockUtils';
import { autoAdjustedViewportStore } from '../lib/markdownCodeBlockState';
import { useMarkdownCodeBlockRendering } from '../lib/useMarkdownCodeBlockRendering';
import { useZoomableDiagramViewport } from '../lib/useZoomableDiagramViewport';
import { useMermaidDraftPreview } from '../lib/useMermaidDraftPreview';
import { MarkdownCodeSourcePanel } from './MarkdownCodeSourcePanel';

type MermaidPreviewViewportProps = {
  error?: string;
  isRendering: boolean;
  markup: string;
  persistenceKey: string;
  themeMode: ThemeMode;
};

const MermaidPreviewViewport = memo(({
  error,
  isRendering,
  markup,
  persistenceKey,
}: MermaidPreviewViewportProps) => {
  const [hasInitialAdjusted, setHasInitialAdjusted] = useState(false);

  // 편집 중에도 배율을 유지하기 위해 서명을 markup 대신 persistenceKey 기반으로 설정
  const {
    autoAdjustViewport,
    canvasRef,
    canPan,
    contentRef,
    isDragging,
    resetViewport,
    shellRef,
    viewportHandlers,
    viewportRef,
    zoomIn,
    zoomLabel,
    zoomOut,
  } = useZoomableDiagramViewport(
    !isRendering && !error && !!markup,
    `preview-static-sig`,
    `mermaid-preview:${persistenceKey}`, // 'mermaid-preview:' 접두사로 확실히 격리
  );

  // 미리보기 전용 '맞춤' 동작: 부모 공간을 최대한 채우도록 보정
  const handleFit = () => {
    // 1. 강제 맞춤 수행
    resetViewport();

    // 2. 렌더링 지연 및 ResizeObserver 간섭을 피하기 위해 다음 프레임들에서 반복 보정
    const frames = [16, 100, 300]; // 단계별 지연 (ms)
    frames.forEach(delay => {
      setTimeout(() => {
        resetViewport();
      }, delay);
    });
  };

  useEffect(() => {
    if (!isRendering && !error && markup && !hasInitialAdjusted) {
      // 컴포넌트가 마운트되거나 markup이 로드된 직후 충분한 시간을 두고 맞춤 수행
      const timeoutId = setTimeout(() => {
        handleFit();
        setHasInitialAdjusted(true);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [handleFit, isRendering, error, markup, hasInitialAdjusted]);

  // markup이 아예 비워졌다가 새로 들어오는 경우(초기화 등)를 위해 리셋 로직 추가
  useEffect(() => {
    if (!markup) {
      setHasInitialAdjusted(false);
    }
  }, [markup]);

  return (
    <div className="code-block__source-preview" style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="code-block__source-preview-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>미리보기</span>
        {!isRendering && !error && markup && (
          <div className="code-block__zoom-controls" style={{ scale: '0.8', transformOrigin: 'right center' }}>
            <button className="code-block__zoom-button" type="button" onClick={zoomOut}>-</button>
            <span className="code-block__zoom-value">{zoomLabel}</span>
            <button className="code-block__zoom-button" type="button" onClick={zoomIn}>+</button>
            <button className="code-block__action-button" style={{ marginLeft: '4px', padding: '2px 8px' }} type="button" onClick={handleFit}>맞춤</button>
          </div>
        )}
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: '200px', overflow: 'hidden', padding: '4px' }}>
        {isRendering ? (
          <p className="code-block__status">미리보기 렌더링 중입니다...</p>
        ) : error ? (
          <p className="code-block__status code-block__status--error">{error}</p>
        ) : markup ? (
          <div className="message-image__shell" ref={shellRef} style={{ width: '100%', height: '100%', border: 'none', padding: 0 }}>
            <div className="message-image__frame">
              <div
                {...viewportHandlers}
                className={`message-image__surface${canPan ? ' message-image__surface--interactive' : ''}${isDragging ? ' message-image__surface--dragging' : ''}`}
                ref={viewportRef}
                style={{ borderRadius: 0, border: 'none' }}
              >
                <div className="message-image__canvas" ref={canvasRef}>
                  <div
                    className="message-image__content"
                    dangerouslySetInnerHTML={{ __html: markup }}
                    ref={contentRef}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="code-block__status">미리보기를 표시할 코드가 없습니다.</p>
        )}
      </div>
    </div>
  );
});

type MarkdownMermaidBlockProps = {
  code: string;
  language: string;
  persistenceKey: string;
  renderNonce?: number;
  sharedCacheScope?: string;
  themeMode: ThemeMode;
};

export function MarkdownMermaidBlock({
  code,
  language,
  persistenceKey,
  renderNonce = 0,
  sharedCacheScope,
  themeMode,
}: MarkdownMermaidBlockProps) {
  const codeBlockRef = useRef<HTMLDivElement>(null);
  const codeContentRef = useRef<HTMLDivElement>(null);

  const isSvgBlock = language === 'svg' || (language === 'xml' && code.includes('<svg'));

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
    isRenderableBlock: true,
    isSvgBlock,
    language,
    persistenceKey,
    renderNonce,
    sharedCacheScope,
    themeMode,
  });

  const isRenderedView = viewMode === 'rendered';

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
  const customMermaidSeed = useMemo(
    () => customMermaidSource || transformedMermaidSource || code,
    [code, customMermaidSource, transformedMermaidSource],
  );

  useEffect(() => {
    setCustomMermaidDraft(customMermaidSeed);
  }, [customMermaidSeed]);

  const {
    isPreviewRendering,
    previewError,
    previewMarkup,
  } = useMermaidDraftPreview({
    enabled: !isSvgBlock && viewMode !== 'rendered',
    source: customMermaidDraft,
    themeMode,
  });

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
      // 예전의 훌륭했던 래핑 및 가독성 최적화 동작으로 복구
      autoAdjustViewport();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [resetViewport, isRenderedView, isRendering, scopedPersistenceKey, renderError, renderedMarkup, viewportContentKey]);

  const issueBadgeLabel = useMemo(() => {
    if (!renderIssue) return '';
    if (renderIssue.source === 'original') return '원본 오류';
    if (renderIssue.source === 'custom') return '사용자 오류';
    return renderIssue.severity === 'warning' ? '변환 경고' : '변환 오류';
  }, [renderIssue]);

  const issueDescription = useMemo(() => {
    if (!renderIssue) return '';
    const sourceLabel = renderIssue.source === 'original' ? '원본 Mermaid' : renderIssue.source === 'custom' ? '사용자 Mermaid' : '자동 변환 Mermaid';
    return `${sourceLabel}: ${renderIssue.message}`;
  }, [renderIssue]);

  return (
    <div className="code-block" ref={codeBlockRef}>
      <div className="code-block__header">
        <div className="code-block__header-meta">
          <span className="code-block__language">{formatCodeLanguageLabel(language)}</span>
          {(isRenderedView ? hasOverflow : codeOverflow) && <span className="code-block__overflow-badge">overflow</span>}
          {renderIssue && <span className={`code-block__issue-badge code-block__issue-badge--${renderIssue.severity}`}>{issueBadgeLabel}</span>}
        </div>
        <div className="code-block__actions">
          {isRenderedView && !isRendering && !renderError && (
            <div className="code-block__zoom-controls">
              <button aria-label="다이어그램 축소" className="code-block__zoom-button" type="button" onClick={zoomOut}>-</button>
              <span className="code-block__zoom-value">{zoomLabel}</span>
              <button aria-label="다이어그램 확대" className="code-block__zoom-button" type="button" onClick={zoomIn}>+</button>
            </div>
          )}
          {isRenderedView && !isRendering && !renderError && (
            <>
              <button className="code-block__action-button" type="button" onClick={resetViewport}>맞춤</button>
              <button className="code-block__action-button" type="button" onClick={autoAdjustViewport}>자동조절</button>
            </>
          )}
          <button
            className="code-block__action-button"
            type="button"
            onClick={() => setViewMode(current => current === 'code' ? 'rendered' : 'code')}
          >
            {isRenderedView ? '코드 보기' : '렌더링'}
          </button>
        </div>
      </div>

      {isRenderedView ? (
        <div className="code-block__rendered">
          {renderIssue && <div className={`code-block__issue-panel code-block__issue-panel--${renderIssue.severity}`}>{issueDescription}</div>}
          {isRendering ? (
            <p className="code-block__status">렌더링 중입니다...</p>
          ) : renderError ? (
            <p className="code-block__status code-block__status--error">{renderError}</p>
          ) : (
            <div className="code-block__rendered-shell" ref={shellRef}>
              <div className="code-block__rendered-frame">
                <div
                  {...viewportHandlers}
                  className={`code-block__rendered-surface${canPan ? ' code-block__rendered-surface--interactive' : ''}${isDragging ? ' code-block__rendered-surface--dragging' : ''}`}
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
        <div className="code-block__content" ref={codeContentRef} style={{ width: '100%', maxWidth: '100%' }}>
          {renderIssue && <div className={`code-block__issue-panel code-block__issue-panel--${renderIssue.severity}`}>{issueDescription}</div>}
          {!isSvgBlock ? (
            <div className="code-block__source-compare" style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'row', width: '100%', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MarkdownCodeSourcePanel language={language} themeMode={themeMode} title="원본 Mermaid" value={code} />
                </div>
                {transformedMermaidSource && transformedMermaidSource.trim() !== code.trim() && (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <MarkdownCodeSourcePanel
                      language={language}
                      themeMode={themeMode}
                      title={transformedMermaidLabel ? `${transformedMermaidLabel} 수정 Mermaid` : '수정 Mermaid'}
                      value={transformedMermaidSource}
                    />
                  </div>
                )}
              </div>

              <div style={{ width: '100%' }}>
                <MarkdownCodeSourcePanel
                  actions={
                    <>
                      <button className="code-block__action-button" type="button" onClick={() => { saveCustomMermaidSource(customMermaidDraft); setViewMode('rendered'); }}>캐시에 저장 후 렌더</button>
                      <button className="code-block__action-button" type="button" onClick={() => { clearCustomMermaidSource(); setCustomMermaidDraft(transformedMermaidSource || code); setViewMode('rendered'); }}>사용자 코드 초기화</button>
                    </>
                  }
                  editable
                  language={language}
                  onChange={setCustomMermaidDraft}
                  preview={
                    <MermaidPreviewViewport
                      error={previewError}
                      isRendering={isPreviewRendering}
                      markup={previewMarkup}
                      persistenceKey={persistenceKey}
                      themeMode={themeMode}
                    />
                  }
                  themeMode={themeMode}
                  title={hasCustomMermaidSource ? '사용자 직접 수정 Mermaid (사용 중)' : '사용자 직접 수정 Mermaid'}
                  value={customMermaidDraft}
                />
              </div>
            </div>
          ) : (
            <div style={{ width: '100%' }}>
              <MarkdownCodeSourcePanel language={language} themeMode={themeMode} title="" value={code} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
