import { PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

type DiagramMetrics = {
  contentHeight: number;
  contentWidth: number;
  fitScale: number;
  geometricFitScale: number;
  maxScale: number;
  minScale: number;
  readableMinScale: number;
  viewportHeight: number;
  viewportWidth: number;
};

type DiagramTransform = {
  scale: number;
  x: number;
  y: number;
};

type PersistedViewportState = DiagramTransform & {
  contentSignature: string;
  shellHeight?: number;
  shellWidth?: number;
};

type DiagramUiState = {
  canPan: boolean;
  hasOverflow: boolean;
  zoomLabel: string;
};

const DRAG_PADDING = 24;
const FIT_PADDING = 12;
const MIN_SCALE_FLOOR = 0.05;
const MAX_READABLE_SCALE = 12;
const READABLE_FIT_EPSILON = 0.05;
const ZOOM_STEP = 1.2;
const MAX_READABLE_SHELL_WIDTH = 1200; // 6400 -> 1200으로 대폭 축소
const MAX_READABLE_SHELL_HEIGHT = 800; // 4800 -> 800으로 대폭 축소
const MERMAID_TEXT_CANDIDATE_SELECTORS = [
  'text',
  'foreignObject div',
  'foreignObject span',
  'foreignObject p',
  'foreignObject li',
  'foreignObject code',
  'foreignObject strong',
  'foreignObject em',
  '.nodeLabel',
  '.edgeLabel',
  '.cluster-label',
  '.label',
].join(', ');

const intrinsicSizeStore = new Map<string, { height: number; width: number }>();
const svgMinFontSizeStore = new Map<string, number | null>();

// localStorage를 사용한 영구 저장소 구현
const PERSISTENCE_STORAGE_KEY = 'gptviewer-viewport-cache-v1';

const loadPersistedViewportStore = (): Record<string, PersistedViewportState> => {
  try {
    const data = localStorage.getItem(PERSISTENCE_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

const savePersistedViewportStore = (store: Record<string, PersistedViewportState>) => {
  try {
    // 너무 비대해지는 것을 방지하기 위해 최근 200개 정도만 유지 (필요 시)
    localStorage.setItem(PERSISTENCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 용량 초과 시 오래된 데이터 삭제 로직을 추가할 수 있음
  }
};

const persistedViewportStore = loadPersistedViewportStore();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getAvailableShellWidth = (shellElement: HTMLDivElement) => {
  const parent = shellElement.parentElement;
  if (!parent) return 1;

  // 부모의 실제 가용 너비(패딩 제외)를 계산
  const styles = window.getComputedStyle(parent);
  const paddingLeft = parseFloat(styles.paddingLeft || '0');
  const paddingRight = parseFloat(styles.paddingRight || '0');
  const parentInnerWidth = parent.clientWidth - paddingLeft - paddingRight;

  // 가용 너비와 시스템 최대치 중 작은 값 선택
  return Math.max(Math.min(parentInnerWidth, MAX_READABLE_SHELL_WIDTH), 1);
};

const clampShellWidthToBounds = (shellElement: HTMLDivElement) => {
  const maxWidth = getAvailableShellWidth(shellElement);
  if (shellElement.clientWidth > maxWidth + 1) {
    shellElement.style.width = `${maxWidth}px`;
  }
};

const applyNaturalSize = (
  svgElement: SVGSVGElement,
  width: number,
  height: number,
) => {
  if (
    svgElement.dataset.gptviewerNaturalWidth === String(width) &&
    svgElement.dataset.gptviewerNaturalHeight === String(height)
  ) {
    return;
  }

  svgElement.style.maxWidth = 'none';
  svgElement.style.width = `${width}px`;
  svgElement.style.height = `${height}px`;
  svgElement.dataset.gptviewerNaturalWidth = String(width);
  svgElement.dataset.gptviewerNaturalHeight = String(height);
};

const readSvgContentSize = (
  contentElement: HTMLDivElement,
  contentSignature: string,
) => {
  const cachedSize = intrinsicSizeStore.get(contentSignature);
  const svgElement = contentElement.querySelector('svg');

  if (!svgElement) {
    return cachedSize ?? null;
  }

  if (cachedSize) {
    applyNaturalSize(svgElement, cachedSize.width, cachedSize.height);
    return cachedSize;
  }

  const viewBox = svgElement.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    const nextSize = { height: viewBox.height, width: viewBox.width };
    applyNaturalSize(svgElement, nextSize.width, nextSize.height);
    intrinsicSizeStore.set(contentSignature, nextSize);
    return nextSize;
  }

  const width = svgElement.width?.baseVal?.value;
  const height = svgElement.height?.baseVal?.value;
  if (width && height) {
    const nextSize = { height, width };
    applyNaturalSize(svgElement, width, height);
    intrinsicSizeStore.set(contentSignature, nextSize);
    return nextSize;
  }

  return null;
};

const readImageContentSize = (contentElement: HTMLDivElement) => {
  const imageElement = contentElement.querySelector('img');
  if (!imageElement) {
    return null;
  }

  // 1. 데이터셋에 저장된 natural size가 있다면 우선 사용
  if (imageElement.dataset.naturalWidth && imageElement.dataset.naturalHeight) {
    return {
      height: Number(imageElement.dataset.naturalHeight),
      width: Number(imageElement.dataset.naturalWidth),
    };
  }

  const naturalWidth = imageElement.naturalWidth || imageElement.width;
  const naturalHeight = imageElement.naturalHeight || imageElement.height;
  if (naturalWidth > 0 && naturalHeight > 0) {
    return {
      height: naturalHeight,
      width: naturalWidth,
    };
  }

  return null;
};

const readBaseFontSize = (contentElement: HTMLDivElement) => {
  const referenceElement =
    contentElement.closest('.message-bubble__content') ?? document.documentElement;
  const fontSize = parseFloat(window.getComputedStyle(referenceElement).fontSize || '16');
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
};

const readSvgMinimumTextFontSize = (
  contentElement: HTMLDivElement,
  contentSignature: string,
) => {
  if (svgMinFontSizeStore.has(contentSignature)) {
    return svgMinFontSizeStore.get(contentSignature) ?? null;
  }

  const svgElement = contentElement.querySelector('svg');
  if (!svgElement) {
    svgMinFontSizeStore.set(contentSignature, null);
    return null;
  }

  const textElements = Array.from(
    svgElement.querySelectorAll(MERMAID_TEXT_CANDIDATE_SELECTORS),
  ).filter((element, index, array) => array.indexOf(element) === index);
  let minFontSize: number | null = null;

  for (const textElement of textElements) {
    if (!textElement.textContent?.trim()) {
      continue;
    }

    const styles = window.getComputedStyle(textElement);
    if (
      styles.display === 'none' ||
      styles.visibility === 'hidden' ||
      Number(styles.opacity || '1') === 0
    ) {
      continue;
    }

    const bounds = textElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      continue;
    }

    const nextFontSize = parseFloat(
      styles.fontSize || textElement.getAttribute('font-size') || '',
    );
    if (!Number.isFinite(nextFontSize) || nextFontSize <= 0) {
      continue;
    }

    minFontSize =
      minFontSize === null ? nextFontSize : Math.min(minFontSize, nextFontSize);
  }

  svgMinFontSizeStore.set(contentSignature, minFontSize);
  return minFontSize;
};

const measureDiagramMetrics = (
  viewportElement: HTMLDivElement,
  contentElement: HTMLDivElement,
  contentSignature: string,
): DiagramMetrics => {
  const viewportWidth = Math.max(viewportElement.clientWidth - FIT_PADDING * 2, 1);
  const viewportHeight = Math.max(
    viewportElement.clientHeight - FIT_PADDING * 2,
    1,
  );
  const svgSize = readSvgContentSize(contentElement, contentSignature);
  const imageSize = readImageContentSize(contentElement);
  const contentWidth = Math.max(
    svgSize?.width ||
      imageSize?.width ||
      contentElement.scrollWidth ||
      contentElement.offsetWidth,
    1,
  );
  const contentHeight = Math.max(
    svgSize?.height ||
      imageSize?.height ||
      contentElement.scrollHeight ||
      contentElement.offsetHeight,
    1,
  );
  const fitScale = Math.min(
    viewportWidth / contentWidth,
    viewportHeight / contentHeight,
    1,
  );
  const baseFontSize = readBaseFontSize(contentElement);
  const minTextFontSize = readSvgMinimumTextFontSize(contentElement, contentSignature);
  
  // 이미지는 100% (scale = 1) 가 가독성이 좋은 최소 크기가 됨
  const imageReadableMinScale = imageSize ? 1.0 : fitScale;

  const readableMinScale = minTextFontSize
    ? clamp(baseFontSize / minTextFontSize, MIN_SCALE_FLOOR, MAX_READABLE_SCALE)
    : imageReadableMinScale;
    
  return {
    contentHeight,
    contentWidth,
    fitScale,
    geometricFitScale: fitScale,
    maxScale: Math.max(fitScale * 6, readableMinScale * 1.5, 2),
    minScale: Math.max(Math.min(fitScale * 0.5, fitScale), MIN_SCALE_FLOOR),
    readableMinScale,
    viewportHeight,
    viewportWidth,
  };
};

const centerOffset = (
  metrics: DiagramMetrics,
  scale: number,
): Pick<DiagramTransform, 'x' | 'y'> => ({
  x: (metrics.viewportWidth - metrics.contentWidth * scale) / 2,
  y: (metrics.viewportHeight - metrics.contentHeight * scale) / 2,
});

const clampOffsets = (
  metrics: DiagramMetrics,
  scale: number,
  x: number,
  y: number,
): Pick<DiagramTransform, 'x' | 'y'> => {
  const scaledWidth = metrics.contentWidth * scale;
  const scaledHeight = metrics.contentHeight * scale;

  if (scaledWidth <= metrics.viewportWidth) {
    x = centerOffset(metrics, scale).x;
  } else {
    x = clamp(
      x,
      metrics.viewportWidth - scaledWidth - DRAG_PADDING,
      DRAG_PADDING,
    );
  }

  if (scaledHeight <= metrics.viewportHeight) {
    y = centerOffset(metrics, scale).y;
  } else {
    y = clamp(
      y,
      metrics.viewportHeight - scaledHeight - DRAG_PADDING,
      DRAG_PADDING,
    );
  }

  return { x, y };
};

const toZoomLabel = (scale: number, fitScale: number) => {
  const zoomRatio = fitScale ? scale / fitScale : 1;
  return `${Math.round(zoomRatio * 100)}%`;
};

const sanitizeScale = (scale: number, metrics: DiagramMetrics) => {
  if (!Number.isFinite(scale) || scale <= 0) {
    return metrics.fitScale || 1;
  }
  return clamp(scale, metrics.minScale, metrics.maxScale);
};

const sanitizeTransform = (
  transform: DiagramTransform,
  metrics: DiagramMetrics,
): DiagramTransform => {
  const safeScale = sanitizeScale(transform.scale, metrics);
  const safeX = Number.isFinite(transform.x) ? transform.x : centerOffset(metrics, safeScale).x;
  const safeY = Number.isFinite(transform.y) ? transform.y : centerOffset(metrics, safeScale).y;
  const safeOffset = clampOffsets(metrics, safeScale, safeX, safeY);
  return {
    scale: safeScale,
    x: safeOffset.x,
    y: safeOffset.y,
  };
};

export function useZoomableDiagramViewport(
  enabled: boolean,
  contentSignature: string,
  persistenceKey: string,
) {
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    originX: number;
    originY: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const metricsRef = useRef<DiagramMetrics | null>(null);
  const transformRef = useRef<DiagramTransform>({ scale: 1, x: 0, y: 0 });
  const lastContentSignatureRef = useRef<string | null>(null);
  const applyFrameRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const publishedUiRef = useRef<DiagramUiState>({
    canPan: false,
    hasOverflow: false,
    zoomLabel: '100%',
  });
  const [isDragging, setIsDragging] = useState(false);
  const [uiState, setUiState] = useState<DiagramUiState>({
    canPan: false,
    hasOverflow: false,
    zoomLabel: '100%',
  });

  const persistViewport = () => {
    const shellElement = shellRef.current;
    if (!shellElement) return;

    const nextState: PersistedViewportState = {
      contentSignature,
      scale: transformRef.current.scale,
      shellHeight: shellElement.clientHeight,
      shellWidth: shellElement.clientWidth,
      x: transformRef.current.x,
      y: transformRef.current.y,
    };

    persistedViewportStore[persistenceKey] = nextState;
    savePersistedViewportStore(persistedViewportStore);
  };

  const publishUiState = () => {
    const metrics = metricsRef.current;
    if (!metrics) {
      return;
    }

    const { scale } = transformRef.current;
    const isAtFitScale = Math.abs(scale - metrics.fitScale) <= READABLE_FIT_EPSILON;
    const hasOverflow =
      !isAtFitScale &&
      (metrics.contentWidth * scale > metrics.viewportWidth + 2 ||
        metrics.contentHeight * scale > metrics.viewportHeight + 2);
    const nextUiState = {
      canPan: hasOverflow,
      hasOverflow,
      zoomLabel: toZoomLabel(scale, metrics.fitScale),
    };

    if (
      publishedUiRef.current.canPan === nextUiState.canPan &&
      publishedUiRef.current.hasOverflow === nextUiState.hasOverflow &&
      publishedUiRef.current.zoomLabel === nextUiState.zoomLabel
    ) {
      return;
    }

    publishedUiRef.current = nextUiState;
    setUiState(nextUiState);
  };

  const applyTransform = (force = false) => {
    const canvasElement = canvasRef.current;
    const metrics = metricsRef.current;

    if (!canvasElement || !metrics) {
      return;
    }

    const nextTransformValue = sanitizeTransform(transformRef.current, metrics);
    transformRef.current = nextTransformValue;
    const { scale, x, y } = nextTransformValue;
    const nextTransform = `translate(${x}px, ${y}px) scale(${scale})`;
    const nextWidth = `${metrics.contentWidth}px`;
    const nextHeight = `${metrics.contentHeight}px`;

    if (
      !force &&
      canvasElement.style.transform === nextTransform &&
      canvasElement.style.width === nextWidth &&
      canvasElement.style.height === nextHeight
    ) {
      publishUiState();
      return;
    }

    canvasElement.style.width = nextWidth;
    canvasElement.style.height = nextHeight;
    canvasElement.style.transform = nextTransform;
    publishUiState();
    persistViewport();
  };

  const scheduleTransform = () => {
    if (applyFrameRef.current !== null) {
      return;
    }

    applyFrameRef.current = window.requestAnimationFrame(() => {
      applyFrameRef.current = null;
      applyTransform();
    });
  };

  const resizeShellToReadableScale = (
    shellElement: HTMLDivElement,
    metrics: DiagramMetrics,
    targetScale: number,
  ) => {
    const maxWidth = getAvailableShellWidth(shellElement);
    const maxHeight = Math.min(MAX_READABLE_SHELL_HEIGHT, window.innerHeight * 0.7);
    
    // 셸이 부모 가용 너비를 넘지 않도록 강력히 제한 (핸들 가시성 및 UI 유지)
    const requiredWidth = metrics.contentWidth * targetScale + FIT_PADDING * 2;
    const requiredHeight = metrics.contentHeight * targetScale + FIT_PADDING * 2;
    
    const nextWidth = Math.min(requiredWidth, maxWidth);
    const nextHeight = Math.min(requiredHeight, maxHeight);

    shellElement.style.width = `${nextWidth}px`;
    shellElement.style.height = `${nextHeight}px`;
  };

  const centerTransformAtScale = (metrics: DiagramMetrics, scale: number) => {
    const centeredOffset = centerOffset(metrics, scale);
    const nextOffset = clampOffsets(
      metrics,
      scale,
      centeredOffset.x,
      centeredOffset.y,
    );

    transformRef.current = {
      scale,
      x: nextOffset.x,
      y: nextOffset.y,
    };
    applyTransform(true);
  };

  const syncViewport = (mode: 'fit' | 'preserve') => {
    const shellElement = shellRef.current;
    const viewportElement = viewportRef.current;
    const contentElement = contentRef.current;

    if (!enabled || !shellElement || !viewportElement || !contentElement) {
      return;
    }

    clampShellWidthToBounds(shellElement);

    let nextMetrics = measureDiagramMetrics(
      viewportElement,
      contentElement,
      contentSignature,
    );
    nextMetrics = measureDiagramMetrics(
      viewportElement,
      contentElement,
      contentSignature,
    );
    metricsRef.current = nextMetrics;

    const persistedState = persistedViewportStore[persistenceKey];
    const baseTransform =
      mode === 'preserve' &&
      persistedState &&
      persistedState.contentSignature === contentSignature
        ? persistedState
        : transformRef.current;
    const normalizedBaseTransform = sanitizeTransform(baseTransform, nextMetrics);
    const nextScale = mode === 'fit'
      ? nextMetrics.fitScale
      : normalizedBaseTransform.scale;
    const nextOffset =
      mode === 'fit'
        ? centerOffset(nextMetrics, nextScale)
        : clampOffsets(
            nextMetrics,
            nextScale,
            normalizedBaseTransform.x,
            normalizedBaseTransform.y,
          );

    transformRef.current = {
      scale: nextScale,
      x: nextOffset.x,
      y: nextOffset.y,
    };
    applyTransform(true);
  };

  const refreshMetrics = () => {
    const viewportElement = viewportRef.current;
    const contentElement = contentRef.current;
    if (!enabled || !viewportElement || !contentElement) {
      return null;
    }

    const refreshedMetrics = measureDiagramMetrics(
      viewportElement,
      contentElement,
      contentSignature,
    );
    metricsRef.current = refreshedMetrics;
    return refreshedMetrics;
  };

  const autoAdjustViewport = () => {
    const shellElement = shellRef.current;
    const viewportElement = viewportRef.current;
    const contentElement = contentRef.current;

    if (!enabled || !shellElement || !viewportElement || !contentElement) {
      return;
    }

    const initialMetrics = measureDiagramMetrics(
      viewportElement,
      contentElement,
      contentSignature,
    );
    const targetScale = clamp(
      Math.max(initialMetrics.readableMinScale, initialMetrics.fitScale),
      initialMetrics.minScale,
      initialMetrics.maxScale,
    );

    // 이미지의 경우 너무 크게 확대되지 않도록 제한 (최대 1.2배)
    const safeTargetScale = initialMetrics.readableMinScale === 1.0 
      ? Math.min(targetScale, 1.2)
      : targetScale;

    if (safeTargetScale <= initialMetrics.fitScale + READABLE_FIT_EPSILON) {
      syncViewport('fit');
      return;
    }

    resizeShellToReadableScale(shellElement, initialMetrics, safeTargetScale);

    window.requestAnimationFrame(() => {
      const refreshedViewport = viewportRef.current;
      const refreshedContent = contentRef.current;
      const refreshedShell = shellRef.current;
      if (!refreshedViewport || !refreshedContent || !refreshedShell) {
        return;
      }

      const refreshedMetrics = measureDiagramMetrics(
        refreshedViewport,
        refreshedContent,
        contentSignature,
      );
      const refinedTargetScale = Math.max(
        refreshedMetrics.readableMinScale,
        refreshedMetrics.fitScale,
      );

      resizeShellToReadableScale(refreshedShell, refreshedMetrics, refinedTargetScale);

      window.requestAnimationFrame(() => {
        const finalViewport = viewportRef.current;
        const finalContent = contentRef.current;
        if (!finalViewport || !finalContent) {
          return;
        }

        const finalMetrics = measureDiagramMetrics(
          finalViewport,
          finalContent,
          contentSignature,
        );
        metricsRef.current = finalMetrics;
        centerTransformAtScale(
          finalMetrics,
          clamp(
            refinedTargetScale,
            finalMetrics.minScale,
            finalMetrics.maxScale,
          ),
        );
      });
    });
  };

  const updateScale = (factor: number) => {
    const metrics = refreshMetrics() ?? metricsRef.current;
    if (!metrics) {
      return;
    }

    const baseTransform = sanitizeTransform(transformRef.current, metrics);
    const { scale, x, y } = baseTransform;
    const nextScale = clamp(scale * factor, metrics.minScale, metrics.maxScale);
    const centerX = metrics.viewportWidth / 2;
    const centerY = metrics.viewportHeight / 2;
    const contentX = (centerX - x) / scale;
    const contentY = (centerY - y) / scale;
    const nextOffset = clampOffsets(
      metrics,
      nextScale,
      centerX - contentX * nextScale,
      centerY - contentY * nextScale,
    );

    transformRef.current = {
      scale: nextScale,
      x: nextOffset.x,
      y: nextOffset.y,
    };
    applyTransform();
  };

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const shellElement = shellRef.current;
    const persistedState = persistedViewportStore[persistenceKey];

    if (
      shellElement &&
      persistedState?.shellWidth &&
      persistedState?.shellHeight &&
      !shellElement.dataset.gptviewerViewportRestored
    ) {
      const maxWidth = getAvailableShellWidth(shellElement);
      shellElement.style.width = `${Math.min(persistedState.shellWidth, maxWidth)}px`;
      shellElement.style.height = `${persistedState.shellHeight}px`;
      shellElement.dataset.gptviewerViewportRestored = 'true';
    }
  }, [enabled, persistenceKey]);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const isFirstEnable = lastContentSignatureRef.current === null;
    const isNewContent = !isFirstEnable && lastContentSignatureRef.current !== contentSignature;
    const persistedState = persistedViewportStore[persistenceKey];
    const hasValidPersistedState = persistedState?.contentSignature === contentSignature;

    // 1. 저장된 상태가 있다면(사용자가 이미 조작했다면) 무조건 'preserve'
    // 2. 처음 로드된 완전 새로운 콘텐츠라면 'fit'
    // 3. 그 외에는 기존 상태 유지
    const mode = hasValidPersistedState ? 'preserve' : isNewContent ? 'fit' : 'preserve';
    
    lastContentSignatureRef.current = contentSignature;
    syncViewport(mode);
  }, [contentSignature, enabled, persistenceKey]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) {
        return;
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        persistViewport();
        syncViewport('preserve');
      });
    });

    if (shellRef.current) {
      resizeObserver.observe(shellRef.current);
    }

    if (viewportRef.current) {
      resizeObserver.observe(viewportRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [enabled, contentSignature, persistenceKey]);

  useEffect(() => {
    return () => {
      if (applyFrameRef.current !== null) {
        window.cancelAnimationFrame(applyFrameRef.current);
      }

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !uiState.canPan) {
      return;
    }

    dragStateRef.current = {
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    const metrics = metricsRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId || !metrics) {
      return;
    }

    const nextX = dragState.originX + (event.clientX - dragState.startX);
    const nextY = dragState.originY + (event.clientY - dragState.startY);
    const nextOffset = clampOffsets(
      metrics,
      transformRef.current.scale,
      nextX,
      nextY,
    );

    transformRef.current = {
      ...transformRef.current,
      x: nextOffset.x,
      y: nextOffset.y,
    };
    scheduleTransform();
  };

  const stopDragging = (event?: PointerEvent<HTMLDivElement>) => {
    if (
      event &&
      dragStateRef.current?.pointerId === event.pointerId &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = null;
    setIsDragging(false);
    applyTransform();
  };

  return {
    autoAdjustViewport,
    canvasRef,
    canPan: uiState.canPan,
    contentRef,
    hasOverflow: uiState.hasOverflow,
    isDragging,
    resetViewport: () => {
      syncViewport('fit');
    },
    shellRef,
    viewportHandlers: {
      onPointerCancel: stopDragging,
      onPointerDown: handlePointerDown,
      onPointerLeave: stopDragging,
      onPointerMove: handlePointerMove,
      onPointerUp: stopDragging,
    },
    viewportRef,
    zoomIn: () => {
      if (!metricsRef.current) {
        syncViewport('preserve');
      }
      updateScale(ZOOM_STEP);
    },
    zoomLabel: uiState.zoomLabel,
    zoomOut: () => {
      if (!metricsRef.current) {
        syncViewport('preserve');
      }
      updateScale(1 / ZOOM_STEP);
    },
  };
}
