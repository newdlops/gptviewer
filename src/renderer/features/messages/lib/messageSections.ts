import type { Message } from '../../../types/chat';

const FENCED_CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\([^)]+\)/g;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\([^)]+\)/g;
const MARKDOWN_DECORATION_PATTERN = /[*_~`>#|]/g;
const LEADING_LIST_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+/;
const MULTI_SPACE_PATTERN = /\s+/g;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?。！？])\s+/;
const MAX_SECTION_LABEL_LENGTH = 72;

export type MessageSection = {
  id: string;
  label: string;
  messageId: string;
  start: number;
};

type LayoutLike = {
  message: Message;
  start: number;
};

const clampSectionLabel = (value: string) =>
  value.length > MAX_SECTION_LABEL_LENGTH
    ? `${value.slice(0, MAX_SECTION_LABEL_LENGTH - 1).trimEnd()}…`
    : value;

const cleanInlineMarkdown = (value: string) =>
  value
    .replace(MARKDOWN_IMAGE_PATTERN, '$1')
    .replace(MARKDOWN_LINK_PATTERN, '$1')
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(LEADING_LIST_PATTERN, '')
    .replace(MARKDOWN_DECORATION_PATTERN, ' ')
    .replace(MULTI_SPACE_PATTERN, ' ')
    .trim();

const extractHeading = (text: string) => {
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    const headingMatch = trimmedLine.match(/^#{1,6}\s+(.+)$/);

    if (!headingMatch) {
      continue;
    }

    const cleanedHeading = cleanInlineMarkdown(headingMatch[1]);

    if (cleanedHeading.length > 0) {
      return cleanedHeading;
    }
  }

  return null;
};

const extractFallbackSummary = (text: string) => {
  const withoutCodeBlocks = text.replace(FENCED_CODE_BLOCK_PATTERN, ' ');
  const cleanedText = cleanInlineMarkdown(withoutCodeBlocks);

  if (!cleanedText) {
    return null;
  }

  const [firstSentence] = cleanedText.split(SENTENCE_SPLIT_PATTERN);

  if (firstSentence?.trim()) {
    return firstSentence.trim();
  }

  return cleanedText;
};

export const extractMessageSectionLabel = (message: Message) => {
  const heading = extractHeading(message.text);

  if (heading) {
    return clampSectionLabel(heading);
  }

  const fallbackSummary = extractFallbackSummary(message.text);

  if (!fallbackSummary) {
    return null;
  }

  return clampSectionLabel(fallbackSummary);
};

export const buildMessageSections = (layouts: LayoutLike[]) => {
  const sections: MessageSection[] = [];
  let previousLabel = '';

  for (const layout of layouts) {
    if (layout.message.role !== 'assistant') {
      continue;
    }

    const label = extractMessageSectionLabel(layout.message);

    if (!label || label === previousLabel) {
      continue;
    }

    sections.push({
      id: `${layout.message.id}:${layout.start}`,
      label,
      messageId: layout.message.id,
      start: layout.start,
    });
    previousLabel = label;
  }

  return sections;
};
