export type ConversationRowMenuButtonPointResult =
  | { status: 'ready'; x: number; y: number }
  | { status: 'button_not_found' }
  | { status: 'not_found' };

export const buildGetConversationRowMenuButtonPointScript = (
  chatUrl: string,
  labels: string[],
  testIds: string[] = [],
  listSelectors: string[] = [],
) => `
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const toUrl = (value) => {
    try {
      return new URL(value, window.location.origin);
    } catch {
      return null;
    }
  };
  const targetUrl = toUrl(${JSON.stringify(chatUrl)});
  const targetPathname = targetUrl?.pathname.replace(/\\/$/, '') || '';
  const chatId = targetPathname.match(/\\/c\\/([^/?#]+)/)?.[1] || '';
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const listSelectors = ${JSON.stringify(listSelectors)};
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const matchesConversationHref = (href) => {
    const parsed = toUrl(href);
    if (!parsed) return false;
    const pathname = parsed.pathname.replace(/\\/$/, '');
    return pathname === targetPathname || pathname.includes('/c/' + chatId);
  };
  const matchesMenuButton = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    const hasTrailingButton = element.hasAttribute('data-trailing-button');
    const hasTrailingClass = element.classList.contains('__menu-item-trailing-btn');
    const isMenuButton = normalize(element.getAttribute('aria-haspopup')) === 'menu';
    return (
      testIds.has(testId) ||
      hasTrailingButton ||
      hasTrailingClass ||
      (isMenuButton && (ariaLabel.includes('conversation options') || title.includes('conversation options'))) ||
      labels.some((label) =>
        ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
      )
    );
  };
  const forceVisible = (element) => {
    if (!(element instanceof HTMLElement)) return;
    const targets = [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean);
    for (const target of targets) {
      if (!(target instanceof HTMLElement)) continue;
      target.style.setProperty('opacity', '1', 'important');
      target.style.setProperty('visibility', 'visible', 'important');
      target.style.setProperty('pointer-events', 'auto', 'important');
    }
  };
  const listRoots = listSelectors
    .map((selector) => document.querySelector(selector))
    .filter((element) => element instanceof HTMLElement && isVisible(element));
  const searchRoots = listRoots.length ? listRoots : [document];
  const targetEntry = searchRoots
    .flatMap((root) => Array.from(root.querySelectorAll('li')))
    .map((row) => ({ row, link: row.querySelector(':scope > a[href], a[href]') }))
    .find(({ row, link }) =>
      row instanceof HTMLElement &&
      isVisible(row) &&
      link instanceof HTMLAnchorElement &&
      matchesConversationHref(link.href),
    );
  if (!(targetEntry?.row instanceof HTMLElement)) {
    return { status: 'not_found' };
  }
  const row = targetEntry.row;
  const button = Array.from(
    row.querySelectorAll('button, [role="button"], [data-trailing-button], .__menu-item-trailing-btn'),
  ).find((element) => matchesMenuButton(element));
  if (!(button instanceof HTMLElement)) {
    return { status: 'button_not_found' };
  }
  forceVisible(button);
  const rect = button.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { status: 'button_not_found' };
  }
  return {
    status: 'ready',
    x: Math.max(4, Math.round(rect.left + rect.width / 2)),
    y: Math.max(4, Math.round(rect.top + rect.height / 2)),
  };
})()
`;
