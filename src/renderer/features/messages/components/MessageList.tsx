import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Conversation,
  Message,
  MessageSource,
  SourcePreview,
  ThemeMode,
} from '../../../types/chat';
import { buildMessageSections } from '../lib/messageSections';
import { VirtualizedMessageBubble } from './VirtualizedMessageBubble';
import { SectionOutline, SectionAnchor } from './SectionOutline';
import {
  MESSAGE_LIST_GAP,
  MESSAGE_LIST_BOTTOM_PADDING,
  MESSAGE_LIST_OVERSCAN,
  MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT,
  CODE_BLOCK_KEEPALIVE_MULTIPLIER_ABOVE,
  CODE_BLOCK_KEEPALIVE_MULTIPLIER_BELOW,
  DIAGRAM_KEEPALIVE_MULTIPLIER_ABOVE,
  DIAGRAM_KEEPALIVE_MULTIPLIER_BELOW,
  RENDERABLE_DIAGRAM_PATTERN,
  MessageLayout,
  estimateMessageHeight,
  findStartIndex,
  findEndIndex,
} from './messageListUtils';

const CODE_BLOCK_PATTERN = /```[\w+-]*\n|```/;
const RENDERABLE_IMAGE_MARKDOWN_PATTERN =
  /!\[[^\]]*\]\((?:data:image\/|https?:\/\/|sediment:\/\/file_[a-z0-9_-]+)/i;

export type MessageListProps = {
  activeConversation: Conversation;
  initialMessageHeights?: Record<string, number>;
  initialScrollTop?: number;
  onMessageHeightChange: (
    conversationId: string,
    messageId: string,
    height: number,
  ) => void;
  onScrollPositionChange: (conversationId: string, scrollTop: number) => void;
  onSourcePreviewNeeded: (source: MessageSource) => void;
  onToggleSourceDrawer: (message: Message) => void;
  sourceDrawerMessageId?: string;
  sourcePreviewCache: Record<string, SourcePreview>;
  sourcePreviewLoading: Record<string, boolean>;
  renderNonce: number;
  themeMode: ThemeMode;
  sendMessageStatus?: 'idle' | 'sending' | 'receiving';
};

export function MessageList({
  activeConversation,
  initialMessageHeights,
  initialScrollTop,
  onMessageHeightChange,
  onScrollPositionChange,
  onSourcePreviewNeeded,
  onToggleSourceDrawer,
  sourceDrawerMessageId,
  sourcePreviewCache,
  sourcePreviewLoading,
  renderNonce,
  themeMode,
  sendMessageStatus,
}: MessageListProps) {
  const conversationRenderKey = `${activeConversation.id}:${activeConversation.fetchedAt ?? 'base'}`;
  const messageListShellRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const onScrollPositionChangeRef = useRef(onScrollPositionChange);
  const scrollFrameRef = useRef<number | null>(null);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const jumpHighlightTimeoutRef = useRef<number | null>(null);
  const highlightedAnchorRef = useRef<HTMLElement | null>(null);
  const highlightedBubbleRef = useRef<HTMLElement | null>(null);
  const restoredConversationKeyRef = useRef<string | null>(null);
  const autoBottomConversationKeyRef = useRef<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const isAutoBottomRef = useRef(false);
  const lastFetchedAtRef = useRef(activeConversation.fetchedAt);
  const lastConversationIdRef = useRef(activeConversation.id);
  const [scrollTop, setScrollTop] = useState(initialScrollTop ?? 0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(
    () => initialMessageHeights ?? {},
  );

  const lastSendMessageStatusRef = useRef(sendMessageStatus);

  useEffect(() => {
    if (activeConversation.id !== lastConversationIdRef.current) {
      isAutoBottomRef.current = false;
    }

    if (sendMessageStatus === 'receiving' && lastSendMessageStatusRef.current !== 'receiving') {
      isAutoBottomRef.current = true;
    }

    if (activeConversation.id === lastConversationIdRef.current && 
        activeConversation.fetchedAt !== lastFetchedAtRef.current) {
      isAutoBottomRef.current = true;
      autoBottomConversationKeyRef.current = conversationRenderKey;
    }
    
    lastFetchedAtRef.current = activeConversation.fetchedAt;
    lastConversationIdRef.current = activeConversation.id;
    lastSendMessageStatusRef.current = sendMessageStatus;
  }, [activeConversation.id, activeConversation.fetchedAt, conversationRenderKey, sendMessageStatus]);

  useEffect(() => {
    onScrollPositionChangeRef.current = onScrollPositionChange;
  }, [onScrollPositionChange]);

  useEffect(() => {
    setMeasuredHeights(initialMessageHeights ?? {});
  }, [activeConversation.id, initialMessageHeights]);

  useLayoutEffect(() => {
    const messageListElement = messageListRef.current;

    if (!messageListElement) {
      return;
    }

    const updateViewportHeight = () => {
      setViewportHeight(messageListElement.clientHeight);
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateViewportHeight();
    });

    resizeObserver.observe(messageListElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const { allLayouts, totalHeight, visibleLayouts } = useMemo(() => {
    const layouts: MessageLayout[] = [];
    let offset = 0;

    for (const message of activeConversation.messages) {
      const height = measuredHeights[message.id] ?? estimateMessageHeight(message);

      layouts.push({
        end: offset + height,
        height,
        message,
        start: offset,
      });

      offset += height + MESSAGE_LIST_GAP;
    }

    const normalizedViewportHeight =
      viewportHeight || MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT;
    const totalContentHeight =
      layouts.length > 0
        ? layouts[layouts.length - 1].end + MESSAGE_LIST_BOTTOM_PADDING
        : normalizedViewportHeight;

    if (layouts.length === 0) {
      return {
        allLayouts: layouts,
        totalHeight: totalContentHeight,
        visibleLayouts: layouts,
      };
    }

    const startIndex = findStartIndex(
      layouts,
      Math.max(scrollTop - MESSAGE_LIST_OVERSCAN, 0),
    );
    const endIndex = findEndIndex(
      layouts,
      scrollTop + normalizedViewportHeight + MESSAGE_LIST_OVERSCAN,
    );

    return {
      allLayouts: layouts,
      totalHeight: Math.max(totalContentHeight, normalizedViewportHeight),
      visibleLayouts: layouts.slice(startIndex, endIndex + 1),
    };
  }, [activeConversation.messages, measuredHeights, scrollTop, viewportHeight]);

  const renderedLayouts = useMemo(() => {
    if (allLayouts.length === 0) {
      return visibleLayouts;
    }

    const normalizedViewportHeight =
      viewportHeight || MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT;
    const codeKeepAliveStart =
      scrollTop - normalizedViewportHeight * CODE_BLOCK_KEEPALIVE_MULTIPLIER_ABOVE;
    const codeKeepAliveEnd =
      scrollTop + normalizedViewportHeight * CODE_BLOCK_KEEPALIVE_MULTIPLIER_BELOW;
    const keepAliveStart =
      scrollTop - normalizedViewportHeight * DIAGRAM_KEEPALIVE_MULTIPLIER_ABOVE;
    const keepAliveEnd =
      scrollTop + normalizedViewportHeight * DIAGRAM_KEEPALIVE_MULTIPLIER_BELOW;
    
    const codeLayouts = allLayouts.filter(
      (layout) =>
        CODE_BLOCK_PATTERN.test(layout.message.text) &&
        layout.end >= codeKeepAliveStart &&
        layout.start <= codeKeepAliveEnd,
    );

    const diagramLayouts = allLayouts.filter(
      (layout) =>
        (RENDERABLE_DIAGRAM_PATTERN.test(layout.message.text) ||
          RENDERABLE_IMAGE_MARKDOWN_PATTERN.test(layout.message.text)) &&
        layout.end >= keepAliveStart &&
        layout.start <= keepAliveEnd,
    );

    if (diagramLayouts.length === 0 && codeLayouts.length === 0) {
      return visibleLayouts;
    }

    const layoutsByMessageId = new Map<string, MessageLayout>();
    visibleLayouts.forEach((layout) => layoutsByMessageId.set(layout.message.id, layout));
    codeLayouts.forEach((layout) => layoutsByMessageId.set(layout.message.id, layout));
    diagramLayouts.forEach((layout) => layoutsByMessageId.set(layout.message.id, layout));

    return Array.from(layoutsByMessageId.values()).sort(
      (left, right) => left.start - right.start,
    );
  }, [allLayouts, scrollTop, viewportHeight, visibleLayouts]);

  const sections = useMemo(() => buildMessageSections(allLayouts), [allLayouts]);
  
  const commitScrollPosition = useCallback(
    (nextScrollTop: number) => {
      const messageListElement = messageListRef.current;
      if (!messageListElement) return;

      if (programmaticScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      }

      isProgrammaticScrollRef.current = true;
      messageListElement.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      onScrollPositionChangeRef.current(activeConversation.id, nextScrollTop);
      programmaticScrollFrameRef.current = window.requestAnimationFrame(() => {
        programmaticScrollFrameRef.current = null;
        isProgrammaticScrollRef.current = false;
      });
    },
    [activeConversation.id],
  );

  const maxScrollTop = useMemo(
    () =>
      Math.max(
        totalHeight - (viewportHeight || MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT),
        0,
      ),
    [totalHeight, viewportHeight],
  );

  useLayoutEffect(() => {
    if (restoredConversationKeyRef.current !== conversationRenderKey) return;
    if (!isAutoBottomRef.current) return;

    const messageListElement = messageListRef.current;
    if (!messageListElement) return;

    const maxScroll = Math.max(totalHeight - messageListElement.clientHeight, 0);
    if (isAutoBottomRef.current || (maxScroll - messageListElement.scrollTop < 150)) {
      commitScrollPosition(maxScroll);
    }
  }, [totalHeight, sendMessageStatus, conversationRenderKey, commitScrollPosition]);

  useLayoutEffect(() => {
    const messageListElement = messageListRef.current;
    if (!messageListElement) return;
    if (restoredConversationKeyRef.current === conversationRenderKey) return;

    let frameId = 0;
    let nestedFrameId = 0;

    const restoreScrollPosition = () => {
      const maxScrollTop = Math.max(totalHeight - messageListElement.clientHeight, 0);
      const nextScrollTop = typeof initialScrollTop === 'number' ? Math.min(initialScrollTop, maxScrollTop) : 0;
      commitScrollPosition(nextScrollTop);
    };

    autoBottomConversationKeyRef.current = null;
    restoredConversationKeyRef.current = conversationRenderKey;
    frameId = window.requestAnimationFrame(() => {
      restoreScrollPosition();
      nestedFrameId = window.requestAnimationFrame(() => {
        restoreScrollPosition();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(nestedFrameId);
    };
  }, [activeConversation.id, conversationRenderKey, initialScrollTop]);

  useLayoutEffect(() => {
    if (autoBottomConversationKeyRef.current !== conversationRenderKey) return;

    const messageListElement = messageListRef.current;
    if (!messageListElement) return;

    const maxScrollTop = Math.max(totalHeight - messageListElement.clientHeight, 0);
    commitScrollPosition(maxScrollTop);
  }, [conversationRenderKey, totalHeight, viewportHeight]);

  useEffect(() => {
    return () => {
      const messageListElement = messageListRef.current;
      if (!messageListElement) return;
      onScrollPositionChangeRef.current(activeConversation.id, messageListElement.scrollTop);
    };
  }, [activeConversation.id]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      if (programmaticScrollFrameRef.current !== null) window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      if (jumpHighlightTimeoutRef.current !== null) window.clearTimeout(jumpHighlightTimeoutRef.current);
      highlightedAnchorRef.current?.classList.remove('message-list__jump-highlight');
      highlightedBubbleRef.current?.classList.remove('message-bubble--jump-highlight');
    };
  }, []);

  const handleMessageHeightChange = (messageId: string, height: number) => {
    setMeasuredHeights((currentHeights) => {
      if (currentHeights[messageId] === height) return currentHeights;
      onMessageHeightChange(activeConversation.id, messageId, height);
      return { ...currentHeights, [messageId]: height };
    });
  };

  const handleMessageListScroll = () => {
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const messageListElement = messageListRef.current;
      if (!messageListElement) return;

      const nextScrollTop = messageListElement.scrollTop;
      const maxScroll = Math.max(messageListElement.scrollHeight - messageListElement.clientHeight, 0);

      if (!isProgrammaticScrollRef.current) {
        autoBottomConversationKeyRef.current = null;
        const distanceFromBottom = maxScroll - nextScrollTop;
        
        if (distanceFromBottom < 20) {
            isAutoBottomRef.current = true;
        } else if (distanceFromBottom > 30) {
            isAutoBottomRef.current = false;
        }
      }

      setScrollTop(nextScrollTop);
      onScrollPositionChange(activeConversation.id, nextScrollTop);
    });
  };

  const handleUserScrollIntent = () => {
    autoBottomConversationKeyRef.current = null;
  };

  const highlightSectionAnchor = useCallback((sectionId: string) => {
    const messageListElement = messageListRef.current;
    if (!messageListElement) return;

    const anchor = messageListElement.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(sectionId)}"]`);
    if (!anchor) return;

    highlightedAnchorRef.current?.classList.remove('message-list__jump-highlight');
    highlightedBubbleRef.current?.classList.remove('message-bubble--jump-highlight');

    anchor.classList.add('message-list__jump-highlight');
    highlightedAnchorRef.current = anchor;

    const bubble = anchor.closest<HTMLElement>('.message-bubble');
    if (bubble && bubble !== anchor) {
      bubble.classList.add('message-bubble--jump-highlight');
      highlightedBubbleRef.current = bubble;
    } else {
      highlightedBubbleRef.current = null;
    }

    if (jumpHighlightTimeoutRef.current !== null) {
      window.clearTimeout(jumpHighlightTimeoutRef.current);
    }

    jumpHighlightTimeoutRef.current = window.setTimeout(() => {
      highlightedAnchorRef.current?.classList.remove('message-list__jump-highlight');
      highlightedBubbleRef.current?.classList.remove('message-bubble--jump-highlight');
      highlightedAnchorRef.current = null;
      highlightedBubbleRef.current = null;
      jumpHighlightTimeoutRef.current = null;
    }, 1800);
  }, []);

  const handleSectionJump = useCallback(
    (section: SectionAnchor) => {
      const targetStart = section.start;
      autoBottomConversationKeyRef.current = null;
      commitScrollPosition(Math.min(targetStart, maxScrollTop));

      const alignToAnchor = () => {
        const messageListElement = messageListRef.current;
        if (!messageListElement) return;

        const anchor = messageListElement.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(section.id)}"]`);
        if (!anchor) return;

        const anchorRect = anchor.getBoundingClientRect();
        const listRect = messageListElement.getBoundingClientRect();
        const nextScrollTop = Math.max(
          Math.min(
            messageListElement.scrollTop +
              (anchorRect.top - listRect.top) -
              (messageListElement.clientHeight / 2 - anchorRect.height / 2),
            maxScrollTop,
          ),
          0,
        );

        commitScrollPosition(nextScrollTop);
        window.requestAnimationFrame(() => highlightSectionAnchor(section.id));
      };

      window.requestAnimationFrame(() => window.requestAnimationFrame(alignToAnchor));
    },
    [commitScrollPosition, highlightSectionAnchor, maxScrollTop],
  );

  return (
    <div className="message-list-shell" ref={messageListShellRef}>
      <div
        className="message-list"
        ref={messageListRef}
        onPointerDownCapture={handleUserScrollIntent}
        onScroll={handleMessageListScroll}
        onTouchStartCapture={handleUserScrollIntent}
        onWheelCapture={handleUserScrollIntent}
      >
        <div className="message-list__viewport" style={{ height: `${totalHeight}px` }}>
          {renderedLayouts.map(({ message, start }) => (
            <VirtualizedMessageBubble
              assetResolveChatUrl={activeConversation.refreshRequest?.chatUrl || activeConversation.sourceUrl || ''}
              key={message.id}
              isSourceDrawerOpen={sourceDrawerMessageId === message.id}
              message={message}
              onHeightChange={handleMessageHeightChange}
              onSourcePreviewNeeded={onSourcePreviewNeeded}
              onToggleSourceDrawer={onToggleSourceDrawer}
              renderNonce={renderNonce}
              sharedCacheScope={activeConversation.refreshRequest?.chatUrl || activeConversation.sourceUrl || activeConversation.id}
              sourcePreviewCache={sourcePreviewCache}
              sourcePreviewLoading={sourcePreviewLoading}
              themeMode={themeMode}
              top={start}
            />
          ))}
        </div>
      </div>
      <SectionOutline onSectionJump={handleSectionJump} sections={sections} />
    </div>
  );
}
