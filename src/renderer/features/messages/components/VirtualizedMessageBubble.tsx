import React, {
  AnchorHTMLAttributes,
  HTMLAttributes,
  ImgHTMLAttributes,
  useCallback,
  memo,
  ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, MessageSource, SourcePreview, ThemeMode } from '../../../types/chat';
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

const DATA_IMAGE_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;
const SEDIMENT_URL_PATTERN = /^sediment:\/\/file_[a-z0-9_-]+/i;
const SAFE_LOCAL_URL_PATTERN = /^(attachment|sandbox|file):/i;

export const markdownUrlTransform = (url: string, key: string): string => {
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

export type VirtualizedMessageBubbleProps = {
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
        const citationRegex = /【(\d+)】|cite(?:[^]*)*?(?:[^]*?(?:turn\d+)?search(\d+)[^]*?)(?:[^]*)*?/g;
        let lastIndex = 0;
        let match;

        while ((match = citationRegex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            let prefix = text.substring(lastIndex, match.index);
            if (prefix.endsWith('(')) {
              prefix = prefix.slice(0, -1);
            }
            parts.push(prefix);
          }

          const sourceNumStr = match[1] || match[2];
          let sourceIndex = -1;

          if (match[1]) {
            sourceIndex = parseInt(match[1], 10) - 1;
          } else if (match[2]) {
            sourceIndex = parseInt(match[2], 10);
          }

          const matchedSource = (sourceIndex >= 0 && message.sources) ? message.sources[sourceIndex] : null;

          if (matchedSource) {
            const displayLabel = matchedSource.attribution || matchedSource.title || `【${sourceIndex + 1}】`;
            parts.push(
              <InlineAssistantLink
                key={`citation-${match.index}`}
                onPreviewNeeded={onSourcePreviewNeeded}
                preview={sourcePreviewCache[matchedSource.url]}
                source={matchedSource}
                sourcePreviewLoading={!!sourcePreviewLoading[matchedSource.url]}
              >
                {displayLabel}
              </InlineAssistantLink>
            );
          } else {
            parts.push(`【${sourceNumStr || '?'}】`);
          }

          lastIndex = match.index + match[0].length;
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

      const finalChildren: ReactNode[] = [];
      for (let i = 0; i < processedChildren.length; i++) {
        const current = processedChildren[i];
        const prev = finalChildren[finalChildren.length - 1];
        const next = processedChildren[i + 1];

        const isCitation = React.isValidElement(current) && (current.type as any) === InlineAssistantLink;

        if (isCitation) {
          if (typeof prev === 'string' && prev.endsWith('(')) {
            finalChildren[finalChildren.length - 1] = prev.slice(0, -1);
          }
          finalChildren.push(current);
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

export const VirtualizedMessageBubble = memo(
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
