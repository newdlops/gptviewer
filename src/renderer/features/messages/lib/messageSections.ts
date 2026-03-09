import type { Message } from '../../../types/chat';

const HTML_TAG_PATTERN = /<[^>]+>/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\([^)]+\)/g;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\([^)]+\)/g;
const MARKDOWN_DECORATION_PATTERN = /[*_~`>#|]/g;
const LEADING_LIST_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+/;
const MULTI_SPACE_PATTERN = /\s+/g;
const MAX_SECTION_LABEL_LENGTH = 72;
const MIN_ASSISTANT_SECTION_LIMIT = 50;
const MAX_ASSISTANT_SECTION_LIMIT = 100;
const ASSISTANT_SECTION_SOFT_CAP = 500;
export type MessageSection = {
  id: string;
  label: string;
  messageId: string;
  role: Message['role'];
  start: number;
};

type LayoutLike = {
  height: number;
  message: Message;
  start: number;
};

const clampSectionLabel = (value: string) =>
  value.length > MAX_SECTION_LABEL_LENGTH
    ? `${value.slice(0, MAX_SECTION_LABEL_LENGTH - 1).trimEnd()}…`
    : value;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const cleanInlineMarkdown = (value: string) =>
  value
    .replace(MARKDOWN_IMAGE_PATTERN, '$1')
    .replace(MARKDOWN_LINK_PATTERN, '$1')
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(LEADING_LIST_PATTERN, '')
    .replace(MARKDOWN_DECORATION_PATTERN, ' ')
    .replace(MULTI_SPACE_PATTERN, ' ')
    .trim();

const extractHeadings = (text: string) => {
  const headings: Array<{ label: string; offset: number }> = [];
  const lines = text.split('\n');
  let consumedOffset = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      consumedOffset += line.length + 1;
      continue;
    }

    const markdownHeadingMatch = trimmedLine.match(/^(#{1,2})\s+(.+)$/);

    if (!markdownHeadingMatch) {
      consumedOffset += line.length + 1;
      continue;
    }

    const headingSource = markdownHeadingMatch[2];
    const cleanedHeading = cleanInlineMarkdown(headingSource);

    if (cleanedHeading.length > 0) {
      headings.push({
        label: clampSectionLabel(cleanedHeading),
        offset: consumedOffset,
      });
    }

    consumedOffset += line.length + 1;
  }

  return headings;
};

const extractUserQuestionLabel = (text: string) => {
  const firstMeaningfulLine = text
    .split('\n')
    .map((line) => cleanInlineMarkdown(line))
    .find((line) => line.length > 0);

  return firstMeaningfulLine ? clampSectionLabel(firstMeaningfulLine) : null;
};

const computeAssistantSectionLimit = (assistantSectionCount: number) => {
  if (assistantSectionCount <= MIN_ASSISTANT_SECTION_LIMIT) {
    return assistantSectionCount;
  }

  if (assistantSectionCount >= ASSISTANT_SECTION_SOFT_CAP) {
    return MAX_ASSISTANT_SECTION_LIMIT;
  }

  const progress =
    (assistantSectionCount - MIN_ASSISTANT_SECTION_LIMIT) /
    (ASSISTANT_SECTION_SOFT_CAP - MIN_ASSISTANT_SECTION_LIMIT);
  const easedProgress = Math.sqrt(progress);
  const limit = Math.round(
    MIN_ASSISTANT_SECTION_LIMIT +
      easedProgress *
        (MAX_ASSISTANT_SECTION_LIMIT - MIN_ASSISTANT_SECTION_LIMIT),
  );

  return clampNumber(
    limit,
    MIN_ASSISTANT_SECTION_LIMIT,
    MAX_ASSISTANT_SECTION_LIMIT,
  );
};

const selectDistributedAssistantSectionIds = (
  sections: MessageSection[],
  limit: number,
) => {
  if (sections.length <= limit) {
    return new Set(sections.map((section) => section.id));
  }

  const selectedIds = new Set<string>();
  const span = sections.length - 1;
  const denominator = Math.max(limit - 1, 1);
  let previousIndex = -1;

  for (let index = 0; index < limit; index += 1) {
    const rawIndex = Math.round((index * span) / denominator);
    const remainingSlots = limit - index - 1;
    const maxAllowedIndex = span - remainingSlots;
    const nextIndex = clampNumber(
      Math.max(rawIndex, previousIndex + 1),
      0,
      maxAllowedIndex,
    );

    selectedIds.add(sections[nextIndex].id);
    previousIndex = nextIndex;
  }

  return selectedIds;
};

export const buildMessageSections = (layouts: LayoutLike[]) => {
  const sections: MessageSection[] = [];
  let previousLabel = '';
  let previousRole: Message['role'] | null = null;

  for (const layout of layouts) {
    if (
      layout.message.role !== 'assistant' &&
      layout.message.role !== 'user'
    ) {
      continue;
    }

    if (layout.message.role === 'user') {
      const userLabel = extractUserQuestionLabel(layout.message.text);

      if (!userLabel) {
        continue;
      }

      if (userLabel === previousLabel && layout.message.role === previousRole) {
        continue;
      }

      sections.push({
        id: `${layout.message.id}:user`,
        label: userLabel,
        messageId: layout.message.id,
        role: layout.message.role,
        start: layout.start,
      });
      previousLabel = userLabel;
      previousRole = layout.message.role;
      continue;
    }

    const headings = extractHeadings(layout.message.text);

    if (headings.length > 0) {
      const messageLength = Math.max(layout.message.text.length, 1);

      for (const heading of headings) {
        if (heading.label === previousLabel && layout.message.role === previousRole) {
          continue;
        }

        const progress = Math.min(
          Math.max(heading.offset / messageLength, 0),
          1,
        );

        sections.push({
          id: `${layout.message.id}:${heading.offset}`,
          label: heading.label,
          messageId: layout.message.id,
          role: layout.message.role,
          start: layout.start + layout.height * progress,
        });
        previousLabel = heading.label;
        previousRole = layout.message.role;
      }

      continue;
    }
  }

  const assistantSections = sections.filter(
    (section) => section.role === 'assistant',
  );
  const assistantSectionLimit = computeAssistantSectionLimit(
    assistantSections.length,
  );
  const selectedAssistantSectionIds = selectDistributedAssistantSectionIds(
    assistantSections,
    assistantSectionLimit,
  );

  return sections.filter(
    (section) =>
      section.role === 'user' || selectedAssistantSectionIds.has(section.id),
  );
};
