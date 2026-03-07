import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageSource, SourcePreview } from '../../../types/chat';
import { getSourceBadgeLabel } from '../lib/sourceUtils';

export function SourceFavicon({
  preview,
  source,
}: {
  preview?: SourcePreview;
  source: MessageSource;
}) {
  const candidates = useMemo(
    () =>
      [preview?.iconUrl, source.iconUrl].filter(
        (candidate, index, list): candidate is string =>
          !!candidate && list.indexOf(candidate) === index,
      ),
    [preview?.iconUrl, source.iconUrl],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const activeIcon = candidates[candidateIndex];
  const candidateKey = candidates.join('|');
  const [resolvedIconSrc, setResolvedIconSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey, source.url]);

  useEffect(() => {
    let isCancelled = false;

    setResolvedIconSrc(undefined);

    if (!activeIcon) {
      return;
    }

    const resolveIcon = async () => {
      try {
        const iconAsset = await window.electronAPI?.fetchSourceIcon(
          activeIcon,
          source.url,
        );

        if (isCancelled) {
          return;
        }

        if (!iconAsset?.dataUrl) {
          throw new Error('아이콘 데이터를 불러오지 못했습니다.');
        }

        setResolvedIconSrc(iconAsset.dataUrl);
      } catch {
        if (isCancelled) {
          return;
        }
        setCandidateIndex((currentIndex) =>
          currentIndex + 1 < candidates.length ? currentIndex + 1 : candidates.length,
        );
      }
    };

    void resolveIcon();

    return () => {
      isCancelled = true;
    };
  }, [activeIcon, candidates.length, source.url]);

  return (
    <span className="message-source-link__media" aria-hidden="true">
      {resolvedIconSrc ? (
        <img
          alt=""
          className="message-source-link__favicon"
          src={resolvedIconSrc}
          onError={() => {
            setCandidateIndex((currentIndex) =>
              currentIndex + 1 < candidates.length
                ? currentIndex + 1
                : candidates.length,
            );
          }}
        />
      ) : null}
      {!resolvedIconSrc ? (
        <span className="message-source-link__badge">
          {getSourceBadgeLabel(source)}
        </span>
      ) : null}
    </span>
  );
}

export function LazySourceFavicon({
  onVisible,
  preview,
  source,
}: {
  onVisible: (source: MessageSource) => void;
  preview?: SourcePreview;
  source: MessageSource;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || isVisible) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            onVisible(source);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '80px 0px',
      },
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [isVisible, onVisible, source]);

  return (
    <span className="message-source-link__icon-slot" ref={containerRef}>
      {isVisible ? (
        <SourceFavicon preview={preview} source={source} />
      ) : (
        <span className="message-source-link__placeholder" aria-hidden="true" />
      )}
    </span>
  );
}
