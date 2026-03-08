export type ProjectConversationListSnapshot = {
  canScrollMore: boolean;
  conversations: Array<{ chatUrl: string; title: string }>;
  lastConversationUrl: string;
  listItemCount: number;
  scrollHeight: number;
  scrollTop: number;
  projectTitle: string;
};

export const buildCollectProjectConversationListSnapshotScript = (
  listSelectors: string[],
) => `
(() => {
  const selectors = ${JSON.stringify(listSelectors)};
  const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const toAbsoluteUrl = (value) => {
    try {
      return new URL(value, window.location.href).toString();
    } catch {
      return '';
    }
  };
  const listRoot = selectors
    .map((selector) => document.querySelector(selector))
    .find((element) => isVisible(element));
  const findScrollTarget = (start) => {
    let current = start instanceof HTMLElement ? start : null;
    while (current) {
      if (current.scrollHeight > current.clientHeight + 24) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement
      : document.documentElement;
  };
  const scrollTarget = findScrollTarget(listRoot);
  const listItems = Array.from(
    (listRoot || document).querySelectorAll('li'),
  ).filter((element) => isVisible(element));
  const titleCandidates = [
    document.querySelector('main h1'),
    document.querySelector('[data-testid*="project"] h1'),
    document.querySelector('header h1'),
    document.querySelector('h1'),
  ]
    .filter((element) => isVisible(element))
    .map((element) => clean(element.textContent));
  const documentTitle = clean(document.title).replace(/\\s*-\\s*ChatGPT\\s*$/i, '');
  const projectTitle = titleCandidates.find(Boolean) || documentTitle || '프로젝트';
  const links = Array.from(
    (listRoot || document).querySelectorAll('li > a[href], li a[href]'),
  )
    .filter((element) =>
      element instanceof HTMLAnchorElement &&
      isVisible(element) &&
      /\\/c\\//.test(element.getAttribute('href') || element.href),
    );
  const conversations = [];
  const seenUrls = new Set();
  for (const link of links) {
    const chatUrl = toAbsoluteUrl(link.getAttribute('href') || link.href);
    if (!chatUrl || seenUrls.has(chatUrl)) {
      continue;
    }
    seenUrls.add(chatUrl);
    const row = link.closest('li, [role="listitem"], article, section, div');
    const titleElement = row?.querySelector('div.text-sm.font-medium');
    const title = clean(titleElement?.textContent) || '프로젝트 대화';
    conversations.push({
      chatUrl,
      title,
    });
  }
  const canScrollMore = scrollTarget
    ? scrollTarget.scrollTop + scrollTarget.clientHeight < scrollTarget.scrollHeight - 8
    : false;
  return {
    canScrollMore,
    conversations,
    lastConversationUrl: conversations.at(-1)?.chatUrl || '',
    listItemCount: listItems.length,
    scrollHeight: scrollTarget instanceof HTMLElement ? scrollTarget.scrollHeight : 0,
    scrollTop: scrollTarget instanceof HTMLElement ? scrollTarget.scrollTop : 0,
    projectTitle,
  };
})()
`;

export const buildScrollProjectConversationListScript = (
  listSelectors: string[],
) => `
(() => {
  const selectors = ${JSON.stringify(listSelectors)};
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const listRoot = selectors
    .map((selector) => document.querySelector(selector))
    .find((element) => isVisible(element));
  const findScrollTarget = (start) => {
    let current = start instanceof HTMLElement ? start : null;
    while (current) {
      if (current.scrollHeight > current.clientHeight + 24) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement
      : document.documentElement;
  };
  const scrollTarget = findScrollTarget(listRoot);
  if (!(scrollTarget instanceof HTMLElement)) {
    return false;
  }
  const listItems = Array.from(
    (listRoot || document).querySelectorAll('li'),
  ).filter((element) => isVisible(element));
  const previousTop = scrollTarget.scrollTop;
  const previousHeight = scrollTarget.scrollHeight;
  const lastItem = listItems.at(-1);
  if (lastItem instanceof HTMLElement) {
    lastItem.scrollIntoView({ block: 'end' });
  }
  scrollTarget.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: Math.max(scrollTarget.clientHeight * 0.92, 420),
  }));
  const nextTop = Math.min(
    scrollTarget.scrollTop + Math.max(scrollTarget.clientHeight * 0.92, 420),
    scrollTarget.scrollHeight - scrollTarget.clientHeight,
  );
  if (nextTop <= previousTop + 4) {
    return scrollTarget.scrollHeight > previousHeight + 4;
  }
  scrollTarget.scrollTo({ top: nextTop, behavior: 'instant' });
  scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
  return true;
})()
`;
