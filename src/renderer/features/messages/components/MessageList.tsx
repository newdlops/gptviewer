import {
  AnchorHTMLAttributes,
  HTMLAttributes,
  ImgHTMLAttributes,
  useCallback,
  memo,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Conversation,
  Message,
  MessageSource,
  SourcePreview,
  ThemeMode,
} from '../../../types/chat';
import {
  getFileReferenceLabel,
  getNodeText,
  isFileLikeHref,
  isFileReferenceLabel,
  normalizeUrlKey,
  stripInlineCitationText,
} from '../lib/sourceUtils';
import { InlineAssistantLink } from './InlineAssistantLink';
import { LazySourceFavicon } from './SourceFavicon';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { MarkdownImageViewport } from './MarkdownImageViewport';
import { buildMessageSections } from '../lib/messageSections';

const MESSAGE_LIST_GAP = 14;
const MESSAGE_LIST_BOTTOM_PADDING = 8;
const MESSAGE_LIST_OVERSCAN = 800;
const MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT = 720;
const CODE_BLOCK_KEEPALIVE_MULTIPLIER_ABOVE = 1.25;
const CODE_BLOCK_KEEPALIVE_MULTIPLIER_BELOW = 1.75;
const DIAGRAM_KEEPALIVE_MULTIPLIER_ABOVE = 2;
const DIAGRAM_KEEPALIVE_MULTIPLIER_BELOW = 3;
const CODE_BLOCK_PATTERN = /```[\w+-]*\n|```/;
const RENDERABLE_DIAGRAM_PATTERN =
  /```(?:mermaid|svg|xml|html|image\/svg\+xml)\b|<svg[\s>]/i;
const RENDERABLE_IMAGE_MARKDOWN_PATTERN =
  /!\[[^\]]*\]\((?:data:image\/|https?:\/\/|sediment:\/\/file_[a-z0-9_-]+)/i;
const DATA_IMAGE_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;
const SEDIMENT_URL_PATTERN = /^sediment:\/\/file_[a-z0-9_-]+/i;
const SAFE_LOCAL_URL_PATTERN = /^(attachment|sandbox|file):/i;

const markdownUrlTransform = (url: string, key: string): string => {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return '';
  }

  if (
    key === 'src' &&
    (DATA_IMAGE_URL_PATTERN.test(normalizedUrl) ||
      SEDIMENT_URL_PATTERN.test(normalizedUrl))
  ) {
    return normalizedUrl;
  }

  if (SAFE_LOCAL_URL_PATTERN.test(normalizedUrl)) {
    return normalizedUrl;
  }

  return defaultUrlTransform(normalizedUrl);
};

type MessageListProps = {
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
};

type MessageLayout = {
  end: number;
  height: number;
  message: Message;
  start: number;
};

type VirtualizedMessageBubbleProps = {
  assetResolveChatUrl: string;
  isSourceDrawerOpen: boolean;
  message: Message;
  onHeightChange: (messageId: string, height: number) => void;
  onSourcePreviewNeeded: (source: MessageSource) => void;
  onToggleSourceDrawer: (message: Message) => void;
  renderNonce: number;
  sharedCacheScope: string;
  sourcePreviewCache: Record<string, SourcePreview>;
  sourcePreviewLoading: Record<string, boolean>;
  themeMode: ThemeMode;
  top: number;
};

type SectionAnchor = {
  id: string;
  label: string;
  role: Message['role'];
  start: number;
};

type SectionOutlineProps = {
  onSectionJump: (section: SectionAnchor) => void;
  sections: SectionAnchor[];
};

const haveRelevantSourceStatesChanged = (
  sources: MessageSource[],
  previousCache: Record<string, SourcePreview>,
  nextCache: Record<string, SourcePreview>,
  previousLoading: Record<string, boolean>,
  nextLoading: Record<string, boolean>,
) =>
  sources.some((source) => {
    const url = source.url;
    return (
      previousCache[url] !== nextCache[url] ||
      !!previousLoading[url] !== !!nextLoading[url]
    );
  });

const estimateMessageHeight = (message: Message): number => {
  const baseHeight = message.role === 'assistant' ? 128 : 92;
  const lineEstimate = Math.ceil(message.text.length / 180) * 24;
  const sourceEstimate = message.sources.length > 0 ? 52 : 0;

  return baseHeight + lineEstimate + sourceEstimate;
};

const findStartIndex = (layouts: MessageLayout[], targetOffset: number): number => {
  let low = 0;
  let high = layouts.length - 1;
  let result = layouts.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (layouts[mid].end >= targetOffset) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result === layouts.length ? Math.max(layouts.length - 1, 0) : result;
};

const findEndIndex = (layouts: MessageLayout[], targetOffset: number): number => {
  let low = 0;
  let high = layouts.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (layouts[mid].start <= targetOffset) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result === -1 ? 0 : result;
};

function VirtualizedMessageBubbleComponent({
  assetResolveChatUrl,
  isSourceDrawerOpen,
  message,
  onHeightChange,
  onSourcePreviewNeeded,
  onToggleSourceDrawer,
  renderNonce,
  sharedCacheScope,
  sourcePreviewCache,
  sourcePreviewLoading,
  themeMode,
  top,
}: VirtualizedMessageBubbleProps) {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const createHeadingComponent = useCallback(
    (Tag: 'h1' | 'h2') =>
      ({
        children,
        node,
        ...props
      }: HTMLAttributes<HTMLHeadingElement> & {
        children?: ReactNode;
        node?: {
          position?: {
            start?: {
              offset?: number;
            };
          };
        };
      }) => {
        const offset =
          typeof node?.position?.start?.offset === 'number'
            ? node.position.start.offset
            : null;
        const sectionId = offset === null ? undefined : `${message.id}:${offset}`;

        return (
          <Tag data-section-id={sectionId} {...props}>
            {children}
          </Tag>
        );
      },
    [message.id],
  );

  useLayoutEffect(() => {
    const element = itemRef.current;

    if (!element) {
      return;
    }

    const measure = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);

      if (nextHeight > 0) {
        onHeightChange(message.id, nextHeight);
      }
    };

    measure();

    const resizeObserver = new ResizeObserver(() => {
      measure();
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [message.id, onHeightChange]);

  const markdownComponents = useMemo(
    () => ({
    a: ({
      href,
      children,
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
      children?: ReactNode;
    }) => {
      if (isFileLikeHref(href) || isFileReferenceLabel(children)) {
        return (
          <button
            className="inline-file-link"
            type="button"
            disabled
            aria-disabled="true"
            tabIndex={-1}
          >
            {getFileReferenceLabel(href, children)}
          </button>
        );
      }

      if (!href || message.role !== 'assistant') {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }

      const normalizedHref = normalizeUrlKey(href);
      const matchedSource =
        message.sources.find(
          (source) => normalizeUrlKey(source.url) === normalizedHref,
        ) ?? {
          title: stripInlineCitationText(getNodeText(children) || href),
          url: href,
        };

      return (
        <InlineAssistantLink
          href={href}
          onPreviewNeeded={onSourcePreviewNeeded}
          preview={sourcePreviewCache[matchedSource.url]}
          source={matchedSource}
          sourcePreviewLoading={!!sourcePreviewLoading[matchedSource.url]}
        >
          {children}
        </InlineAssistantLink>
      );
    },
    code: ({
      children,
      className,
      node,
      ...props
    }: HTMLAttributes<HTMLElement> & {
      children?: ReactNode;
      node?: {
        position?: {
          start?: {
            offset?: number;
          };
        };
      };
    }) => (
      <MarkdownCodeBlock
        className={className}
        persistenceKey={`${message.id}:${className ?? 'text'}:${
          typeof node?.position?.start?.offset === 'number'
            ? node.position.start.offset
            : 'block'
        }`}
        renderNonce={renderNonce}
        sharedCacheScope={sharedCacheScope}
        themeMode={themeMode}
        {...props}
      >
        {children}
      </MarkdownCodeBlock>
    ),
    img: ({
      alt,
      node,
      src,
    }: ImgHTMLAttributes<HTMLImageElement> & {
      node?: {
        position?: {
          start?: {
            offset?: number;
          };
        };
      };
    }) => {
      const imageUrl = typeof src === 'string' ? src.trim() : '';
      if (!imageUrl) {
        return null;
      }

      const offsetKey =
        typeof node?.position?.start?.offset === 'number'
          ? node.position.start.offset
          : imageUrl;

      return (
        <MarkdownImageViewport
          alt={alt}
          chatUrl={assetResolveChatUrl}
          persistenceKey={`${message.id}:img:${offsetKey}`}
          src={imageUrl}
        />
      );
    },
    pre: ({
      children,
    }: HTMLAttributes<HTMLPreElement> & {
      children?: ReactNode;
    }) => <>{children}</>,
    h1: createHeadingComponent('h1'),
    h2: createHeadingComponent('h2'),
    }),
    [
      createHeadingComponent,
      message,
      onSourcePreviewNeeded,
      sourcePreviewCache,
      sourcePreviewLoading,
      assetResolveChatUrl,
      themeMode,
      sharedCacheScope,
    ],
  );

  return (
    <div
      ref={itemRef}
      className="message-list__item"
      style={{ top: `${top}px` }}
    >
      <article
        className={`message-bubble message-bubble--${message.role}`}
        data-section-id={message.role === 'user' ? `${message.id}:user` : undefined}
      >
        {message.role === 'user' ? (
          <div className="message-bubble__meta">
            <span>나</span>
          </div>
        ) : (
          <div className="message-bubble__meta">
            <span>{message.name || 'ChatGPT'}</span>
          </div>
        )}
        <div className="message-bubble__content">
          <ReactMarkdown
            components={markdownComponents}
            remarkPlugins={[remarkGfm]}
            urlTransform={markdownUrlTransform}
          >
            {message.text}
          </ReactMarkdown>
        </div>
        {message.sources.length > 0 ? (
          <button
            className={`message-sources-trigger${isSourceDrawerOpen ? ' is-open' : ''}`}
            type="button"
            aria-expanded={isSourceDrawerOpen}
            onClick={() => onToggleSourceDrawer(message)}
          >
            <span className="message-sources-trigger__preview" aria-hidden="true">
              {message.sources.slice(0, 3).map((source, index) => (
                <LazySourceFavicon
                  key={`${source.url}-${index}`}
                  onVisible={onSourcePreviewNeeded}
                  preview={sourcePreviewCache[source.url]}
                  source={source}
                />
              ))}
            </span>
            <span className="message-sources-trigger__copy">
              <strong>출처 {message.sources.length}개</strong>
              <small>
                {isSourceDrawerOpen ? '오른쪽 패널 닫기' : '오른쪽 패널에서 보기'}
              </small>
            </span>
          </button>
        ) : null}
      </article>
    </div>
  );
}

const VirtualizedMessageBubble = memo(
  VirtualizedMessageBubbleComponent,
  (previousProps, nextProps) => {
    if (
      previousProps.message !== nextProps.message ||
      previousProps.assetResolveChatUrl !== nextProps.assetResolveChatUrl ||
      previousProps.top !== nextProps.top ||
      previousProps.renderNonce !== nextProps.renderNonce ||
      previousProps.themeMode !== nextProps.themeMode ||
      previousProps.isSourceDrawerOpen !== nextProps.isSourceDrawerOpen
    ) {
      return false;
    }

    return !haveRelevantSourceStatesChanged(
      previousProps.message.sources,
      previousProps.sourcePreviewCache,
      nextProps.sourcePreviewCache,
      previousProps.sourcePreviewLoading,
      nextProps.sourcePreviewLoading,
    );
  },
);

const SectionOutline = memo(function SectionOutlineComponent({
  onSectionJump,
  sections,
}: SectionOutlineProps) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <aside className="message-list__outline-column" aria-label="대화 목차">
      <div className="message-list__outline-dock">
        <button
          className="message-list__outline-tab"
          type="button"
          aria-label="대화 목차"
        >
          목차
        </button>
        <div className="message-list__outline-panel">
          <div className="message-list__outline-header">대화 목차</div>
          <div className="message-list__outline-list">
            {sections.map((section, index) => (
              <button
                key={section.id}
                className={`message-list__outline-item${
                  section.role === 'user'
                    ? ' message-list__outline-item--user'
                    : ''
                }`}
                type="button"
                onClick={(event) => {
                  const button = event.currentTarget;
                  onSectionJump(section);
                  window.requestAnimationFrame(() => {
                    button.blur();
                  });
                }}
              >
                <span className="message-list__outline-index">{index + 1}</span>
                <span className="message-list__outline-copy">
                  {section.role === 'user' ? (
                    <span className="message-list__outline-tag">질문</span>
                  ) : null}
                  <span className="message-list__outline-label">
                    {section.label}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
});

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
  const [scrollTop, setScrollTop] = useState(initialScrollTop ?? 0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(
    () => initialMessageHeights ?? {},
  );

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

  useEffect(() => {
    // Auto-scroll to bottom on fresh data or new messages
    if (activeConversation.messages.length > 0) {
        window.requestAnimationFrame(() => {
            const messageListElement = messageListRef.current;
            if (messageListElement) {
                const maxScroll = Math.max(totalHeight - messageListElement.clientHeight, 0);
                commitScrollPosition(maxScroll);
            }
        });
    }
  }, [activeConversation.id, activeConversation.messages.length, totalHeight]);
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
    visibleLayouts.forEach((layout) => {
      layoutsByMessageId.set(layout.message.id, layout);
    });
    codeLayouts.forEach((layout) => {
      layoutsByMessageId.set(layout.message.id, layout);
    });
    diagramLayouts.forEach((layout) => {
      layoutsByMessageId.set(layout.message.id, layout);
    });

    return Array.from(layoutsByMessageId.values()).sort(
      (left, right) => left.start - right.start,
    );
  }, [allLayouts, scrollTop, viewportHeight, visibleLayouts]);
  const sections = useMemo(() => buildMessageSections(allLayouts), [allLayouts]);
  const maxScrollTop = useMemo(
    () =>
      Math.max(
        totalHeight - (viewportHeight || MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT),
        0,
      ),
    [totalHeight, viewportHeight],
  );

  const commitScrollPosition = useCallback(
    (nextScrollTop: number) => {
      const messageListElement = messageListRef.current;

      if (!messageListElement) {
        return;
      }

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

  useLayoutEffect(() => {
    const messageListElement = messageListRef.current;

    if (!messageListElement) {
      return;
    }

    if (restoredConversationKeyRef.current === conversationRenderKey) {
      return;
    }

    let frameId = 0;
    let nestedFrameId = 0;

    const restoreScrollPosition = () => {
      const maxScrollTop = Math.max(
        totalHeight - messageListElement.clientHeight,
        0,
      );
      const nextScrollTop =
        typeof initialScrollTop === 'number'
          ? Math.min(initialScrollTop, maxScrollTop)
          : 0;

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
  }, [
    activeConversation.id,
    conversationRenderKey,
    initialScrollTop,
  ]);

  useLayoutEffect(() => {
    if (autoBottomConversationKeyRef.current !== conversationRenderKey) {
      return;
    }

    const messageListElement = messageListRef.current;

    if (!messageListElement) {
      return;
    }

    const maxScrollTop = Math.max(totalHeight - messageListElement.clientHeight, 0);

    commitScrollPosition(maxScrollTop);
  }, [conversationRenderKey, totalHeight, viewportHeight]);

  useEffect(() => {
    return () => {
      const messageListElement = messageListRef.current;

      if (!messageListElement) {
        return;
      }

      onScrollPositionChangeRef.current(
        activeConversation.id,
        messageListElement.scrollTop,
      );
    };
  }, [activeConversation.id]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      if (programmaticScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      }

      if (jumpHighlightTimeoutRef.current !== null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }

      highlightedAnchorRef.current?.classList.remove('message-list__jump-highlight');
      highlightedBubbleRef.current?.classList.remove(
        'message-bubble--jump-highlight',
      );
    };
  }, []);

  const handleMessageHeightChange = (messageId: string, height: number) => {
    setMeasuredHeights((currentHeights) => {
      if (currentHeights[messageId] === height) {
        return currentHeights;
      }

      const nextHeights = {
        ...currentHeights,
        [messageId]: height,
      };

      onMessageHeightChange(activeConversation.id, messageId, height);
      return nextHeights;
    });
  };

  const handleMessageListScroll = () => {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;

      const messageListElement = messageListRef.current;

      if (!messageListElement) {
        return;
      }

      const nextScrollTop = messageListElement.scrollTop;

      if (!isProgrammaticScrollRef.current) {
        autoBottomConversationKeyRef.current = null;
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

    if (!messageListElement) {
      return;
    }

    const anchor = messageListElement.querySelector<HTMLElement>(
      `[data-section-id="${CSS.escape(sectionId)}"]`,
    );

    if (!anchor) {
      return;
    }

    highlightedAnchorRef.current?.classList.remove('message-list__jump-highlight');
    highlightedBubbleRef.current?.classList.remove(
      'message-bubble--jump-highlight',
    );

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
      highlightedAnchorRef.current?.classList.remove(
        'message-list__jump-highlight',
      );
      highlightedBubbleRef.current?.classList.remove(
        'message-bubble--jump-highlight',
      );
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

        if (!messageListElement) {
          return;
        }

        const anchor = messageListElement.querySelector<HTMLElement>(
          `[data-section-id="${CSS.escape(section.id)}"]`,
        );

        if (!anchor) {
          return;
        }

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
        window.requestAnimationFrame(() => {
          highlightSectionAnchor(section.id);
        });
      };

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(alignToAnchor);
      });
    },
    [commitScrollPosition, highlightSectionAnchor, maxScrollTop],
  );

  return (
    <div
      className="message-list-shell"
      ref={messageListShellRef}
    >
      <div
        className="message-list"
        ref={messageListRef}
        onPointerDownCapture={handleUserScrollIntent}
        onScroll={handleMessageListScroll}
        onTouchStartCapture={handleUserScrollIntent}
        onWheelCapture={handleUserScrollIntent}
      >
        <div
          className="message-list__viewport"
          style={{ height: `${totalHeight}px` }}
        >
          {renderedLayouts.map(({ message, start }) => (
            <VirtualizedMessageBubble
              assetResolveChatUrl={
                activeConversation.refreshRequest?.chatUrl ||
                activeConversation.sourceUrl ||
                ''
              }
              key={message.id}
              isSourceDrawerOpen={sourceDrawerMessageId === message.id}
              message={message}
              onHeightChange={handleMessageHeightChange}
              onSourcePreviewNeeded={onSourcePreviewNeeded}
              onToggleSourceDrawer={onToggleSourceDrawer}
              renderNonce={renderNonce}
              sharedCacheScope={
                activeConversation.refreshRequest?.chatUrl ||
                activeConversation.sourceUrl ||
                activeConversation.id
              }
              sourcePreviewCache={sourcePreviewCache}
              sourcePreviewLoading={sourcePreviewLoading}
              themeMode={themeMode}
              top={start}
            />
          ))}
        </div>
      </div>
      <SectionOutline
        onSectionJump={handleSectionJump}
        sections={sections}
      />
    </div>
  );
}
