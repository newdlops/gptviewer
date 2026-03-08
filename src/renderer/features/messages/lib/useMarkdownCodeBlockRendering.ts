import { RefObject, useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import type { ThemeMode } from '../../../types/chat';
import { queueMermaidRenderTask } from './mermaidRenderQueue';
import {
  pickBestWrappedMermaidCandidate,
  shouldPreferVerticalMermaidLayout,
  shouldPreferWrappedMermaidLayout,
  type WrappedMermaidCandidate,
} from './mermaidLayout';
import {
  autoAdjustedViewportStore,
  customMermaidSourceStore,
  mermaidRenderIssueStore,
  renderedMarkupStore,
  type MermaidRenderIssue,
  type MermaidRenderIssueSource,
  RenderViewMode,
  renderViewModeStore,
  transformedMermaidLabelStore,
  transformedMermaidSourceStore,
} from './markdownCodeBlockState';
import {
  buildCustomMermaidSourceCacheKey,
  clearCustomMermaidSourceFromCache,
  loadCustomMermaidSourceFromCache,
  saveCustomMermaidSourceToCache,
} from './customMermaidSourceCache';
import {
  buildCompactedTopLevelSubgraphVariant,
  buildIndependentTopLevelSubgraphVariant,
  buildVerticalMermaidVariant,
  buildWrappedMermaidVariant,
} from './mermaidVariants';

type UseMarkdownCodeBlockRenderingParams = {
  code: string;
  codeBlockRef: RefObject<HTMLDivElement | null>;
  codeContentRef: RefObject<HTMLDivElement | null>;
  isRenderableBlock: boolean;
  isSvgBlock: boolean;
  language?: string;
  persistenceKey: string;
  renderNonce?: number;
  sharedCacheScope?: string;
  themeMode: ThemeMode;
};

type MermaidRenderResult = {
  issue: MermaidRenderIssue | null;
  markup: string;
  transformedLabel: string;
  transformedSource: string;
};

class MermaidRenderFailure extends Error {
  source: MermaidRenderIssueSource;

  constructor(source: MermaidRenderIssueSource, message: string) {
    super(message);
    this.name = 'MermaidRenderFailure';
    this.source = source;
  }
}

function formatRenderMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : '코드를 렌더링하지 못했습니다.';
}

function buildRenderIssue(
  source: MermaidRenderIssueSource,
  severity: MermaidRenderIssue['severity'],
  message: string,
): MermaidRenderIssue {
  return { message, severity, source };
}

function normalizeCustomMermaidSource(source: string) {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\n$/, '');
  return normalized.trim() ? normalized : '';
}

export const useMarkdownCodeBlockRendering = ({
  code,
  codeBlockRef,
  codeContentRef,
  isRenderableBlock,
  isSvgBlock,
  language,
  persistenceKey,
  renderNonce = 0,
  sharedCacheScope,
  themeMode,
}: UseMarkdownCodeBlockRenderingParams) => {
  const blockId = useId().replace(/:/g, '-');
  const scopedPersistenceKey = `${persistenceKey}:render:${renderNonce}`;
  const sharedCustomMermaidCacheKey = buildCustomMermaidSourceCacheKey(
    sharedCacheScope,
    code,
  );
  const [customMermaidSource, setCustomMermaidSource] = useState(() =>
    customMermaidSourceStore.get(persistenceKey) ||
    loadCustomMermaidSourceFromCache(sharedCustomMermaidCacheKey) ||
    '',
  );
  const isCustomMermaidSourceActive =
    !isSvgBlock && customMermaidSource.trim().length > 0;
  const activeMermaidSource = isCustomMermaidSourceActive
    ? customMermaidSource
    : code;
  const renderCacheKey = `${themeMode}:${language || 'text'}:${
    isCustomMermaidSourceActive ? 'custom' : 'default'
  }:${activeMermaidSource}`;
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
  const [renderIssue, setRenderIssue] = useState<MermaidRenderIssue | null>(
    () => mermaidRenderIssueStore.get(renderCacheKey) ?? null,
  );
  const [renderError, setRenderError] = useState(
    () => mermaidRenderIssueStore.get(renderCacheKey)?.severity === 'error'
      ? (mermaidRenderIssueStore.get(renderCacheKey)?.message ?? '')
      : '',
  );
  const [isRendering, setIsRendering] = useState(false);
  const [codeOverflow, setCodeOverflow] = useState(false);
  const mermaidRenderCountRef = useRef(0);
  const lastRenderNonceRef = useRef(renderNonce);

  useEffect(() => {
    setCustomMermaidSource(
      customMermaidSourceStore.get(persistenceKey) ||
        loadCustomMermaidSourceFromCache(sharedCustomMermaidCacheKey) ||
        '',
    );
  }, [persistenceKey, sharedCustomMermaidCacheKey]);

  useEffect(() => {
    if (lastRenderNonceRef.current === renderNonce) {
      return;
    }

    lastRenderNonceRef.current = renderNonce;
    renderedMarkupStore.delete(renderCacheKey);
    transformedMermaidSourceStore.delete(renderCacheKey);
    transformedMermaidLabelStore.delete(renderCacheKey);
    mermaidRenderIssueStore.delete(renderCacheKey);
    autoAdjustedViewportStore.delete(scopedPersistenceKey);
    setRenderedMarkup('');
    setTransformedMermaidSource('');
    setTransformedMermaidLabel('');
    setRenderIssue(null);
    setRenderError('');
    setIsRendering(false);
    setViewMode('auto');
  }, [renderCacheKey, renderNonce, scopedPersistenceKey]);

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
      const nextIssue = mermaidRenderIssueStore.get(renderCacheKey) ?? null;
      setRenderedMarkup(renderedMarkupStore.get(renderCacheKey) ?? '');
      setTransformedMermaidSource(
        transformedMermaidSourceStore.get(renderCacheKey) ?? '',
      );
      setTransformedMermaidLabel(
        transformedMermaidLabelStore.get(renderCacheKey) ?? '',
      );
      setRenderIssue(nextIssue);
      setRenderError(nextIssue?.severity === 'error' ? nextIssue.message : '');
      setViewMode('rendered');
    }
  }, [isRenderableBlock, renderCacheKey, viewMode]);

  useEffect(() => {
    const nextIssue = mermaidRenderIssueStore.get(renderCacheKey) ?? null;
    setRenderedMarkup(renderedMarkupStore.get(renderCacheKey) ?? '');
    setTransformedMermaidSource(
      transformedMermaidSourceStore.get(renderCacheKey) ?? '',
    );
    setTransformedMermaidLabel(
      transformedMermaidLabelStore.get(renderCacheKey) ?? '',
    );
    setRenderIssue(nextIssue);
    setRenderError(nextIssue?.severity === 'error' ? nextIssue.message : '');
    setIsRendering(false);
  }, [renderCacheKey]);

  useEffect(() => {
    if (viewMode === 'rendered') {
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
      const sourceEditors = Array.from(
        element.querySelectorAll<HTMLElement>('.code-block__source-editor'),
      );
      const targets =
        scrollContainers.length > 0 || sourceEditors.length > 0
          ? [...scrollContainers, ...sourceEditors]
          : [element];
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
  }, [code, codeContentRef, customMermaidSource, language, viewMode]);

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
          const cachedIssue = mermaidRenderIssueStore.get(renderCacheKey) ?? null;
          setRenderedMarkup(cachedMarkup);
          setTransformedMermaidSource(
            transformedMermaidSourceStore.get(renderCacheKey) ?? '',
          );
          setTransformedMermaidLabel(
            transformedMermaidLabelStore.get(renderCacheKey) ?? '',
          );
          setRenderIssue(cachedIssue);
          setRenderError(
            cachedIssue?.severity === 'error' ? cachedIssue.message : '',
          );
          setIsRendering(false);
        }
        return;
      }

      setIsRendering(true);
      setRenderIssue(null);
      setRenderError('');

      try {
        const nextRenderResult = await queueMermaidRenderTask(
          renderCacheKey,
          async (): Promise<MermaidRenderResult> => {
            if (isSvgBlock) {
              return {
                issue: null,
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

            const renderMermaidSource = async (source: string) => {
              mermaidRenderCountRef.current += 1;
              const { svg } = await mermaid.render(
                `mermaid-${blockId}-${mermaidRenderCountRef.current}`,
                source,
              );

              return svg;
            };

            if (isCustomMermaidSourceActive) {
              try {
                return {
                  issue: null,
                  markup: await renderMermaidSource(activeMermaidSource),
                  transformedLabel: '',
                  transformedSource: '',
                };
              } catch (error) {
                throw new MermaidRenderFailure(
                  'custom',
                  formatRenderMessage(error),
                );
              }
            }

            let preferredSvg = '';
            try {
              preferredSvg = await renderMermaidSource(code);
            } catch (error) {
              throw new MermaidRenderFailure(
                'original',
                formatRenderMessage(error),
              );
            }

            let preferredSource = code;
            let preferredLabel = '';
            let wrapperIssue: MermaidRenderIssue | null = null;
            let wrapperIssueSource = '';
            let wrapperIssueLabel = '';
            const noteWrapperIssue = (
              label: string,
              source: string,
              error: unknown,
            ) => {
              if (wrapperIssue) {
                return;
              }

              wrapperIssue = buildRenderIssue(
                'wrapper',
                'warning',
                `${label} 렌더링 실패: ${formatRenderMessage(error)}`,
              );
              wrapperIssueSource = source;
              wrapperIssueLabel = `${label} 오류`;
            };

            const availableRenderWidth = Math.max(
              (codeBlockRef.current?.clientWidth ?? 0) - 32,
              0,
            );
            const verticalVariant = buildVerticalMermaidVariant(code);

            if (verticalVariant) {
              try {
                const verticalSvg = await renderMermaidSource(verticalVariant);
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
              } catch (error) {
                noteWrapperIssue('세로 변환', verticalVariant, error);
              }
            }

            const wrappedCandidates = new Map<
              string,
              { label: string; rowCount: number; source: string }
            >();
            const compactedTopLevelVariant =
              buildCompactedTopLevelSubgraphVariant(code);
            if (compactedTopLevelVariant) {
              wrappedCandidates.set(compactedTopLevelVariant, {
                label: '루트 그룹 조밀 배치',
                rowCount: 2,
                source: compactedTopLevelVariant,
              });
            }

            const independentTopLevelVariant =
              buildIndependentTopLevelSubgraphVariant(code);
            if (independentTopLevelVariant) {
              wrappedCandidates.set(independentTopLevelVariant, {
                label: '독립 그룹 세로 배치',
                rowCount: 2,
                source: independentTopLevelVariant,
              });
            }

            for (const rowCount of [2, 3, 4, 5] as const) {
              const wrappedVariant = buildWrappedMermaidVariant(code, rowCount);
              if (!wrappedVariant || wrappedCandidates.has(wrappedVariant)) {
                continue;
              }

              wrappedCandidates.set(wrappedVariant, {
                label: `자동 줄바꿈 ${rowCount}행 변환`,
                rowCount,
                source: wrappedVariant,
              });
            }

            if (wrappedCandidates.size > 0) {
              const renderedWrappedCandidates: WrappedMermaidCandidate[] = [];

              for (const candidate of wrappedCandidates.values()) {
                try {
                  const wrappedSvg = await renderMermaidSource(candidate.source);
                  renderedWrappedCandidates.push({
                    label: candidate.label,
                    markup: wrappedSvg,
                    rowCount: candidate.rowCount,
                    source: candidate.source,
                  });
                } catch (error) {
                  noteWrapperIssue(candidate.label, candidate.source, error);
                }
              }

              const preferredWrappedCandidate = pickBestWrappedMermaidCandidate(
                renderedWrappedCandidates,
                availableRenderWidth,
              );

              if (
                preferredWrappedCandidate &&
                shouldPreferWrappedMermaidLayout(
                  preferredSvg,
                  preferredWrappedCandidate.markup,
                  availableRenderWidth,
                )
              ) {
                preferredSvg = preferredWrappedCandidate.markup;
                preferredSource = preferredWrappedCandidate.source;
                preferredLabel = preferredWrappedCandidate.label;
              }
            }

            return {
              issue: wrapperIssue,
              markup: preferredSvg,
              transformedLabel:
                preferredSource.trim() !== code.trim()
                  ? preferredLabel
                  : wrapperIssueLabel,
              transformedSource:
                preferredSource.trim() !== code.trim()
                  ? preferredSource
                  : wrapperIssueSource,
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

          if (nextRenderResult.issue) {
            mermaidRenderIssueStore.set(renderCacheKey, nextRenderResult.issue);
          } else {
            mermaidRenderIssueStore.delete(renderCacheKey);
          }

          setRenderedMarkup(nextRenderResult.markup);
          setTransformedMermaidSource(nextRenderResult.transformedSource);
          setTransformedMermaidLabel(nextRenderResult.transformedLabel);
          setRenderIssue(nextRenderResult.issue);
          setRenderError(
            nextRenderResult.issue?.severity === 'error'
              ? nextRenderResult.issue.message
              : '',
          );
          if (shouldPromoteViewMode) {
            setViewMode('rendered');
          }
        }
      } catch (error) {
        if (!isCancelled) {
          const issue =
            error instanceof MermaidRenderFailure
              ? buildRenderIssue(error.source, 'error', error.message)
              : buildRenderIssue(
                  isCustomMermaidSourceActive ? 'custom' : 'original',
                  'error',
                  formatRenderMessage(error),
                );

          renderedMarkupStore.delete(renderCacheKey);
          transformedMermaidSourceStore.delete(renderCacheKey);
          transformedMermaidLabelStore.delete(renderCacheKey);
          mermaidRenderIssueStore.set(renderCacheKey, issue);
          setRenderedMarkup('');
          setTransformedMermaidSource('');
          setTransformedMermaidLabel('');
          setRenderIssue(issue);
          setRenderError(issue.message);
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
    activeMermaidSource,
    blockId,
    code,
    codeBlockRef,
    isCustomMermaidSourceActive,
    isRenderableBlock,
    isSvgBlock,
    renderCacheKey,
    themeMode,
    viewMode,
  ]);

  const saveCustomMermaidSource = (nextSource: string) => {
    const normalized = normalizeCustomMermaidSource(nextSource);
    if (normalized) {
      customMermaidSourceStore.set(persistenceKey, normalized);
      saveCustomMermaidSourceToCache(sharedCustomMermaidCacheKey, normalized);
    } else {
      customMermaidSourceStore.delete(persistenceKey);
      clearCustomMermaidSourceFromCache(sharedCustomMermaidCacheKey);
    }
    setCustomMermaidSource(normalized);
  };

  const clearCustomSource = () => {
    customMermaidSourceStore.delete(persistenceKey);
    clearCustomMermaidSourceFromCache(sharedCustomMermaidCacheKey);
    setCustomMermaidSource('');
  };

  return {
    clearCustomMermaidSource: clearCustomSource,
    codeOverflow,
    customMermaidSource,
    hasCustomMermaidSource: isCustomMermaidSourceActive,
    isRendering,
    renderError,
    renderIssue,
    renderedMarkup,
    saveCustomMermaidSource,
    scopedPersistenceKey,
    transformedMermaidLabel,
    transformedMermaidSource,
    viewMode,
    viewportContentKey: `${renderCacheKey}:${renderedMarkup.length}`,
    setViewMode,
  };
};
