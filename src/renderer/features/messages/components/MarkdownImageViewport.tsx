import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useZoomableDiagramViewport } from '../lib/useZoomableDiagramViewport';

type MarkdownImageViewportProps = {
  alt?: string;
  chatUrl?: string;
  persistenceKey: string;
  src: string;
};

type ImageAssetResolveResult = {
  cacheKey: string;
  dataUrl: string;
  sourceUrl: string;
};

const SEDIMENT_FILE_ID_PATTERN = /^sediment:\/\/(file_[a-z0-9_-]+)/i;
const CHATGPT_ASSET_URL_PATTERN =
  /(?:^https?:\/\/(?:www\.)?chatgpt\.com\/backend-api\/(?:estuary\/content|files\/)|^https?:\/\/chat\.openai\.com\/backend-api\/(?:estuary\/content|files\/)|[?&]id=file_[a-z0-9_-]+)/i;
const LOCAL_IMAGE_ASSET_CACHE = new Map<string, string>();

const extractImageFileId = (value: string): string => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return '';
  }

  const sedimentMatch = normalizedValue.match(SEDIMENT_FILE_ID_PATTERN);
  if (sedimentMatch?.[1]) {
    return sedimentMatch[1].toLowerCase();
  }

  const backendDownloadMatch = normalizedValue.match(
    /\/backend-api\/files\/download\/(file_[a-z0-9_-]+)/i,
  );
  if (backendDownloadMatch?.[1]) {
    return backendDownloadMatch[1].toLowerCase();
  }

  const backendResourceMatch = normalizedValue.match(
    /\/backend-api\/files\/(file_[a-z0-9_-]+)\/download/i,
  );
  if (backendResourceMatch?.[1]) {
    return backendResourceMatch[1].toLowerCase();
  }

  const queryMatch = normalizedValue.match(/[?&]id=(file_[a-z0-9_-]+)/i);
  if (queryMatch?.[1]) {
    return queryMatch[1].toLowerCase();
  }

  return '';
};

function MarkdownImageViewportComponent({
  alt,
  chatUrl,
  persistenceKey,
  src,
}: MarkdownImageViewportProps) {
  const figureRef = useRef<HTMLElement | null>(null);
  const caption = typeof alt === 'string' ? alt.trim() : '';
  const hasCaption = caption.length > 0 && caption.toLowerCase() !== 'image';
  const normalizedChatUrl = (chatUrl || '').trim();
  const normalizedSrc = src.trim();
  const fileId = useMemo(() => extractImageFileId(normalizedSrc), [normalizedSrc]);
  const isSedimentAsset = SEDIMENT_FILE_ID_PATTERN.test(normalizedSrc);
  const isChatGptAssetUrl = CHATGPT_ASSET_URL_PATTERN.test(normalizedSrc);
  const requiresAssetResolve =
    !!normalizedChatUrl && (isSedimentAsset || isChatGptAssetUrl);
  const missingChatUrlForResolve =
    (isSedimentAsset || isChatGptAssetUrl) && !normalizedChatUrl;
  const localCacheKey = useMemo(
    () => `${normalizedChatUrl}::${fileId || normalizedSrc}`,
    [fileId, normalizedChatUrl, normalizedSrc],
  );
  const loadingStatusText = requiresAssetResolve
    ? '이미지 자산을 준비 중입니다...'
    : '이미지 불러오는 중...';
  const slowLoadNotice = requiresAssetResolve
    ? '대화가 크거나 이미지가 많으면 로딩까지 시간이 걸릴 수 있습니다.'
    : '';
  const [isVisible, setIsVisible] = useState(!requiresAssetResolve);
  const [resolvedSrc, setResolvedSrc] = useState(
    requiresAssetResolve ? '' : normalizedSrc,
  );
  const [resolveError, setResolveError] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [naturalSize, setNaturalSize] = useState<{ height: number; width: number } | null>(
    null,
  );
  const contentSignature = useMemo(
    () =>
      `${src}:${naturalSize?.width ?? 0}x${naturalSize?.height ?? 0}:${status === 'ready' ? 'ready' : 'pending'}`,
    [naturalSize?.height, naturalSize?.width, src, status],
  );
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
  } = useZoomableDiagramViewport(status === 'ready', contentSignature, persistenceKey);

  useEffect(() => {
    setResolveError('');
    setIsVisible(!requiresAssetResolve);
    setNaturalSize(null);
    setStatus('loading');
    setResolvedSrc(requiresAssetResolve ? '' : normalizedSrc);
  }, [normalizedSrc, requiresAssetResolve]);

  useEffect(() => {
    const figureElement = figureRef.current;
    if (!figureElement || isVisible || !requiresAssetResolve) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(figureElement);
    return () => {
      observer.disconnect();
    };
  }, [isVisible, requiresAssetResolve]);

  useEffect(() => {
    if (!requiresAssetResolve) {
      return;
    }
    if (!isVisible) {
      return;
    }
    if (resolvedSrc) {
      return;
    }
    if (missingChatUrlForResolve) {
      setResolveError('원본 대화 URL 정보가 없어 이미지를 불러올 수 없습니다.');
      setStatus('error');
      return;
    }

    const cachedDataUrl = LOCAL_IMAGE_ASSET_CACHE.get(localCacheKey);
    if (cachedDataUrl) {
      setResolvedSrc(cachedDataUrl);
      setStatus('loading');
      return;
    }

    let isCancelled = false;
    const resolveAsset = async () => {
      try {
        const result = (await window.electronAPI?.resolveChatGptImageAsset(
          normalizedChatUrl,
          normalizedSrc,
        )) as ImageAssetResolveResult | null;
        if (isCancelled) {
          return;
        }

        if (!result?.dataUrl?.startsWith('data:image/')) {
          setResolveError('이미지 자산을 불러오지 못했습니다.');
          setStatus('error');
          return;
        }

        LOCAL_IMAGE_ASSET_CACHE.set(result.cacheKey || localCacheKey, result.dataUrl);
        LOCAL_IMAGE_ASSET_CACHE.set(localCacheKey, result.dataUrl);
        setResolvedSrc(result.dataUrl);
        setStatus('loading');
      } catch {
        if (isCancelled) {
          return;
        }
        setResolveError('이미지 자산을 불러오는 중 오류가 발생했습니다.');
        setStatus('error');
      }
    };

    void resolveAsset();
    return () => {
      isCancelled = true;
    };
  }, [
    isVisible,
    localCacheKey,
    missingChatUrlForResolve,
    normalizedChatUrl,
    normalizedSrc,
    requiresAssetResolve,
    resolvedSrc,
  ]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      autoAdjustViewport();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [autoAdjustViewport, status, contentSignature]);

  return (
    <figure className="message-image" data-status={status} ref={figureRef}>
      <div className="message-image__header">
        <span className="message-image__label">Image</span>
        {status === 'ready' ? (
          <div className="message-image__actions">
            <div className="message-image__zoom-controls">
              <button
                aria-label="이미지 축소"
                className="message-image__zoom-button"
                type="button"
                onClick={zoomOut}
              >
                -
              </button>
              <span className="message-image__zoom-value">{zoomLabel}</span>
              <button
                aria-label="이미지 확대"
                className="message-image__zoom-button"
                type="button"
                onClick={zoomIn}
              >
                +
              </button>
            </div>
            <button
              className="message-image__action-button"
              type="button"
              onClick={resetViewport}
            >
              맞춤
            </button>
            <button
              className="message-image__action-button"
              type="button"
              onClick={autoAdjustViewport}
            >
              자동조절
            </button>
          </div>
        ) : null}
      </div>
      <div className="message-image__shell" ref={shellRef}>
        <div className="message-image__frame">
          {status === 'error' ? (
            <div className="message-image__status message-image__status--error">
              {resolveError || '이미지를 표시하지 못했습니다.'}{' '}
              <a href={src} target="_blank" rel="noreferrer">
                원본 열기
              </a>
            </div>
          ) : !resolvedSrc ? (
            <p className="message-image__status" role="status">
              {loadingStatusText}
            </p>
          ) : (
            <div
              {...viewportHandlers}
              className={`message-image__surface${
                canPan ? ' message-image__surface--interactive' : ''
              }${isDragging ? ' message-image__surface--dragging' : ''}`}
              ref={viewportRef}
            >
              <div className="message-image__canvas" ref={canvasRef}>
                <div className="message-image__content" ref={contentRef}>
                  <img
                    alt={caption || 'image'}
                    draggable={false}
                    loading="lazy"
                    src={resolvedSrc}
                    onError={() => {
                      setNaturalSize(null);
                      setStatus('error');
                    }}
                    onLoad={(event) => {
                      const imageElement = event.currentTarget;
                      const nextNaturalWidth =
                        imageElement.naturalWidth || imageElement.width || 1;
                      const nextNaturalHeight =
                        imageElement.naturalHeight || imageElement.height || 1;
                      setNaturalSize({
                        height: nextNaturalHeight,
                        width: nextNaturalWidth,
                      });
                      setStatus('ready');
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {status === 'loading' && resolvedSrc ? (
        <p className="message-image__status" role="status">
          {loadingStatusText}
        </p>
      ) : null}
      {status === 'loading' && slowLoadNotice ? (
        <p className="message-image__status message-image__status--warning" role="status">
          {slowLoadNotice}
        </p>
      ) : null}
      {hasCaption ? (
        <figcaption className="message-image__caption">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

export const MarkdownImageViewport = memo(MarkdownImageViewportComponent);
