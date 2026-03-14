import React, {
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
const MESSAGE_LIST_BOTTOM_PADDING = 320; // 하단 여백을 대폭 늘려 스트리밍 공간 확보
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
  sendMessageStatus?: 'idle' | 'sending' | 'receiving';
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

/**
 * Estimating message height helps reduce layout shifts during initial rendering.
 * We include estimates for code blocks and diagrams to reserve enough space 
 * before they are measured and cached in the persistent store.
 */
const estimateMessageHeight = (message: Message): number => {
  const baseHeight = message.role === 'assistant' ? 128 : 92;
  const lineEstimate = Math.ceil(message.text.length / 180) * 24;
  const sourceEstimate = message.sources.length > 0 ? 52 : 0;
  
  // Estimate code block height (roughly 100px per block, or more if it looks long)
  const codeBlocks = message.text.match(/```/g) || [];
  const codeBlockCount = Math.floor(codeBlocks.length / 2);
  const codeBlockEstimate = codeBlockCount * 120;
  
  // Extra height for mermaid or diagrams
  const isDiagram = RENDERABLE_DIAGRAM_PATTERN.test(message.text);
  const diagramEstimate = isDiagram ? 300 : 0;

  return baseHeight + lineEstimate + sourceEstimate + codeBlockEstimate + diagramEstimate;
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
    p: ({ children }: { children?: ReactNode }) => {
      const processTextParts = (text: string): ReactNode[] => {
        const parts: ReactNode[] = [];
        // Combined regex for both standard 【1】 and streaming cite... patterns
        // Pattern 1: 【(\d+)】
        // Pattern 2: cite(?:turn\d+)?search(\d+).*?
        const citationRegex = /【(\d+)】|cite(?:[^]*)*?(?:[^]*?(?:turn\d+)?search(\d+)[^]*?)(?:[^]*)*?/g;
        let lastIndex = 0;
        let match;

        while ((match = citationRegex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            let prefix = text.substring(lastIndex, match.index);
            // 만약 prefix가 '('로 끝나면 마지막 문자를 제거
            if (prefix.endsWith('(')) {
              prefix = prefix.slice(0, -1);
            }
            parts.push(prefix);
          }

          // Group 1 is for 【1】, Group 2 is for searchN in streaming token
          const sourceNumStr = match[1] || match[2];
          const sourceIndex = sourceNumStr ? parseInt(sourceNumStr, 10) - 1 : -1;
          const matchedSource = sourceIndex >= 0 ? message.sources[sourceIndex] : null;

          if (matchedSource) {
            parts.push(
              <InlineAssistantLink
                key={`citation-${match.index}`}
                onPreviewNeeded={onSourcePreviewNeeded}
                preview={sourcePreviewCache[matchedSource.url]}
                source={matchedSource}
                sourcePreviewLoading={!!sourcePreviewLoading[matchedSource.url]}
              >
                {`【${sourceIndex + 1}】`}
              </InlineAssistantLink>
            );
          } else {
            // Fallback: if no metadata yet, show a clean placeholder instead of raw token
            parts.push(`【${sourceNumStr || '?'}】`);
          }
          
          lastIndex = match.index + match[0].length;
          // 만약 text의 다음 문자가 ')'라면 lastIndex를 하나 더 밀어서 ')'를 스킵
          if (text[lastIndex] === ')') {
            lastIndex++;
          }
        }

        if (lastIndex < text.length) {
          parts.push(text.substring(lastIndex));
        }

        return parts;
      };

      const processedChildren = React.Children.toArray(children).flatMap((child) => {
        if (typeof child === 'string') {
          return processTextParts(child);
        }
        return [child];
      });

      // 후처리: InlineAssistantLink 주변의 불필요한 괄호 제거
      const finalChildren: ReactNode[] = [];
      for (let i = 0; i < processedChildren.length; i++) {
        const current = processedChildren[i];
        const prev = finalChildren[finalChildren.length - 1];
        const next = processedChildren[i + 1];

        // 현재 요소가 InlineAssistantLink인 경우 앞뒤 괄호 체크
        const isCitation = React.isValidElement(current) && (current.type as any) === InlineAssistantLink;
        
        if (isCitation) {
          // 앞의 텍스트가 '('로 끝나면 마지막 문자 제거
          if (typeof prev === 'string' && prev.endsWith('(')) {
            finalChildren[finalChildren.length - 1] = prev.slice(0, -1);
          }
          finalChildren.push(current);
          // 뒤의 텍스트가 ')'로 시작하면 첫 문자 제거 (다음 루프에서 처리)
          if (typeof next === 'string' && next.startsWith(')')) {
            processedChildren[i + 1] = next.slice(1);
          }
        } else {
          finalChildren.push(current);
        }
      }

      return <p>{finalChildren}</p>;
    },
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
        data-streaming={message.id === 'streaming-placeholder' ? 'true' : undefined}
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
          {message.text ? (
            <ReactMarkdown
              components={markdownComponents}
              remarkPlugins={[remarkGfm]}
              urlTransform={markdownUrlTransform}
            >
              {message.text}
            </ReactMarkdown>
          ) : message.id === 'streaming-placeholder' ? (
            <div className="message-bubble__streaming-initial" />
          ) : null}
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
  const isAutoBottomRef = useRef(false); // 기본적으로 자동 추적은 끄고 시작
  const lastFetchedAtRef = useRef(activeConversation.fetchedAt);
  const lastConversationIdRef = useRef(activeConversation.id);
  const [scrollTop, setScrollTop] = useState(initialScrollTop ?? 0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(
    () => initialMessageHeights ?? {},
  );

  // fetchedAt이 변경되면(새로고침) 스크롤을 하단으로 유도
  useEffect(() => {
    // 대화방이 바뀌면 자동 추적 상태 리셋 (저장된 위치 복원을 우선하기 위함)
    if (activeConversation.id !== lastConversationIdRef.current) {
      isAutoBottomRef.current = false;
    }

    // 같은 대화방 내에서 데이터가 갱신(fetchedAt 변경)된 경우에만 하단 이동
    if (activeConversation.id === lastConversationIdRef.current && 
        activeConversation.fetchedAt !== lastFetchedAtRef.current) {
      isAutoBottomRef.current = true;
      autoBottomConversationKeyRef.current = conversationRenderKey;
    }
    
    lastFetchedAtRef.current = activeConversation.fetchedAt;
    lastConversationIdRef.current = activeConversation.id;
  }, [activeConversation.id, activeConversation.fetchedAt, conversationRenderKey]);

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

  const maxScrollTop = useMemo(
    () =>
      Math.max(
        totalHeight - (viewportHeight || MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT),
        0,
      ),
    [totalHeight, viewportHeight],
  );

  // 스트리밍 중이거나 자동 추적 모드일 때 스크롤 유지
  useLayoutEffect(() => {
    // 초기 스크롤 복원이 완료된 후에만 자동 추적 로직 작동
    if (restoredConversationKeyRef.current !== conversationRenderKey) {
      return;
    }

    if (!isAutoBottomRef.current && sendMessageStatus !== 'receiving') {
      return;
    }

    const messageListElement = messageListRef.current;
    if (!messageListElement) {
      return;
    }

    const maxScroll = Math.max(totalHeight - messageListElement.clientHeight, 0);

    // 자동 추적 중이거나 사용자가 바닥 근처에 있을 때만 스크롤 내림
    if (isAutoBottomRef.current || (maxScroll - messageListElement.scrollTop < 150)) {
      commitScrollPosition(maxScroll);
    }
  }, [totalHeight, sendMessageStatus, conversationRenderKey, commitScrollPosition]);


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
      const maxScroll = Math.max(messageListElement.scrollHeight - messageListElement.clientHeight, 0);

      if (!isProgrammaticScrollRef.current) {
        autoBottomConversationKeyRef.current = null;
        // 사용자가 스크롤을 끝까지 내렸을 때 자동 추적 모드 재활성화
        if (maxScroll - nextScrollTop < 20) {
            isAutoBottomRef.current = true;
        } else if (maxScroll - nextScrollTop > 100) {
            // 사용자가 의도적으로 위로 스크롤했을 때 자동 추적 모드 비활성화
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
