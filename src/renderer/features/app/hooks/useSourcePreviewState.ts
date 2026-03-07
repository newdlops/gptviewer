import { useEffect, useRef, useState } from 'react';
import { normalizeSourcePreview } from '../../conversations/lib/normalizers';
import type {
  Message,
  MessageSource,
  SourceDrawerState,
  SourcePreview,
} from '../../../types/chat';

export function useSourcePreviewState() {
  const [sourceDrawer, setSourceDrawer] = useState<SourceDrawerState | null>(null);
  const [sourcePreviewCache, setSourcePreviewCache] = useState<
    Record<string, SourcePreview>
  >({});
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState<
    Record<string, boolean>
  >({});
  const sourcePreviewCacheRef = useRef<Record<string, SourcePreview>>({});
  const sourcePreviewRequestRef = useRef<Map<string, Promise<void>>>(new Map());
  const messageScrollPositionsRef = useRef<Record<string, number>>({});
  const messageHeightCacheRef = useRef<Record<string, Record<string, number>>>(
    {},
  );

  useEffect(() => {
    sourcePreviewCacheRef.current = sourcePreviewCache;
  }, [sourcePreviewCache]);

  useEffect(() => {
    if (!sourceDrawer) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSourceDrawer(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [sourceDrawer]);

  useEffect(() => {
    if (!sourceDrawer) {
      return;
    }

    let isCancelled = false;
    const loadSequentially = async () => {
      for (const source of sourceDrawer.sources) {
        if (isCancelled) {
          return;
        }

        await loadSourcePreview(source);
      }
    };

    void loadSequentially();
    return () => {
      isCancelled = true;
    };
  }, [sourceDrawer]);

  const handleMessageListScrollPositionChange = (
    conversationId: string,
    scrollTop: number,
  ) => {
    if (!conversationId) {
      return;
    }

    messageScrollPositionsRef.current[conversationId] = scrollTop;
  };

  const handleMessageHeightChange = (
    conversationId: string,
    messageId: string,
    height: number,
  ) => {
    if (!conversationId || !messageId || height <= 0) {
      return;
    }

    const currentHeights = messageHeightCacheRef.current[conversationId] ?? {};

    if (currentHeights[messageId] === height) {
      return;
    }

    messageHeightCacheRef.current[conversationId] = {
      ...currentHeights,
      [messageId]: height,
    };
  };

  const loadSourcePreview = async (source: MessageSource): Promise<void> => {
    if (
      sourcePreviewCacheRef.current[source.url] ||
      sourcePreviewRequestRef.current.has(source.url)
    ) {
      return;
    }

    setSourcePreviewLoading((currentState) => ({
      ...currentState,
      [source.url]: true,
    }));

    const request = (async () => {
      try {
        const preview = normalizeSourcePreview(
          await window.electronAPI?.fetchSourcePreview(source.url),
        );

        if (!preview) {
          return;
        }

        setSourcePreviewCache((currentCache) => ({
          ...currentCache,
          [source.url]: preview,
        }));
      } finally {
        setSourcePreviewLoading((currentState) => ({
          ...currentState,
          [source.url]: false,
        }));
        sourcePreviewRequestRef.current.delete(source.url);
      }
    })();

    sourcePreviewRequestRef.current.set(source.url, request);
    await request;
  };

  const toggleSourceDrawer = (message: Message) => {
    if (message.sources.length === 0) {
      return;
    }

    setSourceDrawer((currentDrawer) =>
      currentDrawer?.messageId === message.id
        ? null
        : {
            heading:
              message.role === 'assistant'
                ? '어시스턴트 응답 출처'
                : '메시지 출처',
            messageId: message.id,
            sources: message.sources,
          },
    );
  };

  const clearSourceState = () => {
    setSourceDrawer(null);
    setSourcePreviewCache({});
    setSourcePreviewLoading({});
    sourcePreviewRequestRef.current.clear();
    messageHeightCacheRef.current = {};
    messageScrollPositionsRef.current = {};
  };

  const removeConversationScrollState = (conversationIds: string[]) => {
    conversationIds.forEach((conversationId) => {
      delete messageScrollPositionsRef.current[conversationId];
      delete messageHeightCacheRef.current[conversationId];
    });
  };

  return {
    clearSourceState,
    handleMessageHeightChange,
    handleMessageListScrollPositionChange,
    loadSourcePreview,
    messageHeightCacheRef,
    messageScrollPositionsRef,
    removeConversationScrollState,
    setSourceDrawer,
    sourceDrawer,
    sourcePreviewCache,
    sourcePreviewLoading,
    toggleSourceDrawer,
  };
}
