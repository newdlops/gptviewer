import { ReactNode, isValidElement } from 'react';
import type { MessageSource, SourcePreview } from '../../../types/chat';

const PRIVATE_USE_CHARACTER_PATTERN = /[\uE000-\uF8FF]/g;
const FILE_LINK_PROTOCOLS = new Set(['attachment:', 'file:', 'sandbox:']);
const FILE_LINK_PATH_PATTERN =
  /(?:^|\/)(?:mnt\/data|uploads?|files?)(?:\/|$)|\.(?:csv|doc|docx|epub|json|key|md|numbers|pages|pdf|png|jpe?g|gif|webp|ppt|pptx|rtf|tar|txt|xls|xlsx|zip)$/i;

export const getSourceHostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const isUrlLikeText = (value?: string): boolean => {
  if (!value) {
    return false;
  }

  return /^(https?:\/\/|www\.)/i.test(value.trim());
};

export const stripInlineCitationText = (value: string): string =>
  value
    .replace(/\(\s*(?:cite\s*)?turn\d+[^)]*\)/gi, '')
    .replace(
      /(?:^|[\s([{"'`])(?:cite\s*)?turn\d+(?:search|news|finance|sports|weather)?\d+(?=$|[\s)}"'`.,:;!?-])/gi,
      ' ',
    )
    .replace(PRIVATE_USE_CHARACTER_PATTERN, '')
    .replace(/\bcite\b/gi, '')
    .replace(/\s*[()[\]{}<>]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripMarkdownLinks = (value: string): string =>
  value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1').trim();

const stripWrappingPunctuation = (value: string): string =>
  value.replace(/^[\s([{"'`]+/, '').replace(/[\s)\]}"'`]+$/, '').trim();

export const getNodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => getNodeText(child)).join('');
  }

  if (isValidElement(node)) {
    const elementProps = node.props as { children?: ReactNode };
    return getNodeText(elementProps.children);
  }

  return '';
};

export const isFileLikeHref = (href?: string): boolean => {
  if (!href) {
    return false;
  }

  const trimmedHref = href.trim();
  if (!trimmedHref) {
    return false;
  }

  try {
    const parsedUrl = new URL(trimmedHref);
    return (
      FILE_LINK_PROTOCOLS.has(parsedUrl.protocol) ||
      FILE_LINK_PATH_PATTERN.test(parsedUrl.pathname)
    );
  } catch {
    return (
      trimmedHref.startsWith('sandbox:/') ||
      trimmedHref.startsWith('/mnt/data/') ||
      FILE_LINK_PATH_PATTERN.test(trimmedHref)
    );
  }
};

export const normalizeUrlKey = (value: string): string => {
  try {
    const parsedUrl = new URL(value.trim());
    parsedUrl.hash = '';

    if (parsedUrl.pathname.length > 1) {
      parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
    }

    return parsedUrl.toString();
  } catch {
    return value.trim();
  }
};

export const getFileReferenceLabel = (
  href: string | undefined,
  children?: ReactNode,
): string => {
  const text = stripInlineCitationText(getNodeText(children));
  const textRange = text.match(/L\d+(?:-L?\d+)?/i)?.[0];

  if (textRange) {
    return `파일 참조 ${textRange}`;
  }

  if (href) {
    try {
      const parsedUrl = new URL(href);
      const hashRange = decodeURIComponent(parsedUrl.hash.replace(/^#/, '').trim());
      if (hashRange) {
        return `파일 참조 ${hashRange}`;
      }
    } catch {
      return '파일 참조';
    }
  }

  return '파일 참조';
};

export const isFileReferenceLabel = (children?: ReactNode): boolean =>
  /^파일 참조(?:\s+L\d+(?:-L?\d+)?)?$/i.test(
    stripInlineCitationText(getNodeText(children)),
  );

const normalizeComparableLabel = (value?: string): string =>
  (value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/www\./g, '')
    .replace(/[^a-z0-9가-힣]+/g, '');

const buildFallbackTitleFromDescription = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = stripWrappingPunctuation(
    stripInlineCitationText(stripMarkdownLinks(value)),
  );
  if (!normalized) {
    return undefined;
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+|\n+/)[0]?.trim();
  const candidate = firstSentence || normalized;
  return candidate.length > 88 ? `${candidate.slice(0, 85).trim()}...` : candidate;
};

const sanitizeSourceTitle = (value: string, sourceUrl: string): string => {
  const trimmedValue = stripWrappingPunctuation(
    stripInlineCitationText(stripMarkdownLinks(value)),
  );
  if (!trimmedValue) {
    return getSourceHostname(sourceUrl);
  }

  if (isUrlLikeText(trimmedValue)) {
    return getSourceHostname(trimmedValue);
  }

  return trimmedValue;
};

export const getSourceBadgeLabel = (source: MessageSource): string => {
  const hostname = getSourceHostname(source.url);
  const firstCharacter = hostname.charAt(0).toUpperCase();
  return firstCharacter || source.title.charAt(0).toUpperCase() || 'L';
};

export const getSourcePreviewDescription = (
  source: MessageSource,
  preview?: SourcePreview,
): string | undefined =>
  preview?.description ||
  source.description ||
  preview?.publisher ||
  source.publisher;

export const getSourcePreviewTitle = (
  source: MessageSource,
  preview?: SourcePreview,
): string => {
  const hostname = getSourceHostname(source.url);
  const siteName = sanitizeSourceTitle(
    preview?.publisher || source.publisher || hostname,
    source.url,
  );
  const rawTitle = sanitizeSourceTitle(preview?.title || source.title, source.url);

  if (
    normalizeComparableLabel(rawTitle) === normalizeComparableLabel(siteName) ||
    normalizeComparableLabel(rawTitle) === normalizeComparableLabel(hostname)
  ) {
    return (
      buildFallbackTitleFromDescription(getSourcePreviewDescription(source, preview)) ||
      hostname
    );
  }

  return rawTitle;
};

export const getSourcePreviewSiteName = (
  source: MessageSource,
  preview?: SourcePreview,
): string =>
  sanitizeSourceTitle(
    preview?.publisher || source.publisher || getSourceHostname(source.url),
    source.url,
  );

export const getSourcePreviewMeta = (source: MessageSource): string =>
  [source.attribution, getSourceHostname(source.url)].filter(Boolean).join(' · ');
