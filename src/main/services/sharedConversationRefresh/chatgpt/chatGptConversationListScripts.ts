import { ACTIONABLE_SELECTOR } from './chatGptAutomationScripts';

export type ConversationRowMenuStepResult =
  | { status: 'clicked' }
  | { status: 'hovered'; x: number; y: number }
  | { status: 'not_found' }
  | { status: 'scrolled' };

export type ConversationRowMenuAfterHoverResult =
  | { status: 'clicked' }
  | { status: 'not_found' }
  | { status: 'pending' };

export const buildStepConversationRowMenuByChatUrlScript = (
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
  const chatId = (() => {
    try {
      return new URL(${JSON.stringify(chatUrl)}).pathname.match(/\\/c\\/([^/?#]+)/)?.[1] || null;
    } catch {
      return null;
    }
  })();
  if (!chatId) return { status: 'not_found' };
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const listSelectors = ${JSON.stringify(listSelectors)};
  const targetUrl = toUrl(${JSON.stringify(chatUrl)});
  const targetPathname = targetUrl?.pathname.replace(/\\/$/, '') || '';
  const matchesConversationHref = (href) => {
    const parsed = toUrl(href);
    if (!parsed) return false;
    const pathname = parsed.pathname.replace(/\\/$/, '');
    return pathname === targetPathname || pathname.includes('/c/' + chatId);
  };
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const isConversationOptionsButton = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    const hasTrailingButton = element.hasAttribute('data-trailing-button');
    const hasTrailingClass = element.classList.contains('__menu-item-trailing-btn');
    const isMenuButton = normalize(element.getAttribute('aria-haspopup')) === 'menu';
    const matchesKnownButton =
      testIds.has(testId) ||
      hasTrailingButton ||
      hasTrailingClass ||
      (isMenuButton && (ariaLabel.includes('conversation options') || title.includes('conversation options'))) ||
      labels.some((label) =>
      ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
      );
    return matchesKnownButton && isVisible(element);
  };
  const isProjectPage = window.location.pathname.includes('/project');
  const listRoots = listSelectors
    .map((selector) => document.querySelector(selector))
    .filter((element) => element instanceof HTMLElement && isVisible(element));
  const searchRoots = listRoots.length ? listRoots : [document];
  const getConversationRow = (link) =>
    link.closest('li, [role="listitem"], [data-testid], nav > div, section > div, article, main > div') ||
    link.parentElement;
  const getActionTarget = (link) => {
    const row = getConversationRow(link);
    const hoverTargets = [row, link].filter(Boolean);
    for (const target of hoverTargets) {
      target?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      target?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
      target?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      target?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      target?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    }
    if (row instanceof HTMLElement) {
      row.focus?.();
    }
    const scopes = [row, link.parentElement]
      .filter((scope, index, items) => scope && items.indexOf(scope) === index);
    for (const scope of scopes) {
      const preferredTarget = Array.from(scope.querySelectorAll('button, [role="button"], [data-trailing-button], .__menu-item-trailing-btn'))
        .find((element) => element !== link && isConversationOptionsButton(element));
      if (preferredTarget instanceof HTMLElement) {
        return preferredTarget;
      }
      const target = Array.from(scope.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)})).find((element) => {
        if (!(element instanceof HTMLElement) || element === link || !isVisible(element)) return false;
        if (isConversationOptionsButton(element)) return true;
        const text = normalize(element.textContent);
        const ariaLabel = normalize(element.getAttribute('aria-label'));
        const title = normalize(element.getAttribute('title'));
        return labels.some((label) =>
          text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
        );
      });
      if (target instanceof HTMLElement) {
        return target;
      }
    }
    return null;
  };
  const rowEntries = searchRoots
    .flatMap((root) => Array.from(root.querySelectorAll('li')))
    .map((row) => {
      const directLink = row.querySelector(':scope > a[href]');
      const nestedLink = directLink || row.querySelector('a[href]');
      return { link: nestedLink, row };
    });
  const targetEntry = rowEntries.find(({ link, row }) =>
    row instanceof HTMLElement &&
    isVisible(row) &&
    link instanceof HTMLAnchorElement &&
    isVisible(link) &&
    matchesConversationHref(link.href),
  );
  const fallbackLink = targetEntry
    ? null
    : searchRoots
        .flatMap((root) => Array.from(root.querySelectorAll('a[href]')))
        .find((element) =>
          element instanceof HTMLAnchorElement &&
          isVisible(element) &&
          matchesConversationHref(element.href),
        );
  const targetLink = targetEntry?.link instanceof HTMLElement
    ? targetEntry.link
    : fallbackLink;
  const targetRow = targetEntry?.row instanceof HTMLElement
    ? targetEntry.row
    : (targetLink instanceof HTMLElement ? getConversationRow(targetLink) : null);
  if (targetLink instanceof HTMLElement) {
    targetLink.scrollIntoView({ block: 'center' });
    const actionTarget = getActionTarget(targetLink);
    if (actionTarget instanceof HTMLElement) {
      actionTarget.click();
      return { status: 'clicked' };
    }
    const rect = targetRow instanceof HTMLElement
      ? targetRow.getBoundingClientRect()
      : targetLink.getBoundingClientRect();
    return {
      status: 'hovered',
      x: Math.max(4, Math.round(rect.left + Math.min(Math.max(rect.width * 0.45, 48), Math.max(rect.width - 24, 24)))),
      y: Math.max(4, Math.round(rect.top + Math.max(rect.height / 2, 8))),
    };
  }
  const scrollableRoots = listRoots.length ? listRoots : Array.from(document.querySelectorAll('main, nav, aside, section, div, ul, ol'));
  const scrollables = Array.from(scrollableRoots)
    .filter((element) => element instanceof HTMLElement && isVisible(element) && element.scrollHeight > element.clientHeight + 24)
    .map((element) => {
      const hrefCount = element.querySelectorAll('a[href*="/c/"]').length;
      const rect = element.getBoundingClientRect();
      const tagScore = /^(MAIN|NAV|ASIDE|UL|OL)$/i.test(element.tagName) ? 4 : 0;
      const mainScore = isProjectPage && element.closest('main') ? 6 : 0;
      const sizeScore = rect.height > 240 ? 2 : 0;
      return { element, score: hrefCount * 6 + tagScore + mainScore + sizeScore };
    })
    .sort((left, right) => right.score - left.score);
  for (const { element } of scrollables) {
    const previousTop = element.scrollTop;
    const nextTop = Math.min(
      previousTop + Math.max(element.clientHeight * 0.8, 260),
      element.scrollHeight - element.clientHeight,
    );
    if (nextTop > previousTop + 4) {
      element.scrollTop = nextTop;
      return { status: 'scrolled' };
    }
  }
  const previousWindowY = window.scrollY;
  window.scrollTo({ top: previousWindowY + Math.max(window.innerHeight * 0.8, 320), behavior: 'auto' });
  return window.scrollY > previousWindowY + 4
    ? { status: 'scrolled' }
    : { status: 'not_found' };
})()
`;

export const buildWaitForConversationRowMenuAfterHoverScript = (
  chatUrl: string,
  labels: string[],
  testIds: string[] = [],
  listSelectors: string[] = [],
  timeoutMs = 2_000,
) => `
(() => new Promise((resolve) => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const toUrl = (value) => {
    try {
      return new URL(value, window.location.origin);
    } catch {
      return null;
    }
  };
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const listSelectors = ${JSON.stringify(listSelectors)};
  const deadline = Date.now() + ${timeoutMs};
  const targetUrl = toUrl(${JSON.stringify(chatUrl)});
  const targetPathname = targetUrl?.pathname.replace(/\\/$/, '') || '';
  const chatId = targetPathname.match(/\\/c\\/([^/?#]+)/)?.[1] || '';
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
  const isConversationOptionsButton = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    const hasTrailingButton = element.hasAttribute('data-trailing-button');
    const hasTrailingClass = element.classList.contains('__menu-item-trailing-btn');
    const isMenuButton = normalize(element.getAttribute('aria-haspopup')) === 'menu';
    const matchesKnownButton =
      testIds.has(testId) ||
      hasTrailingButton ||
      hasTrailingClass ||
      (isMenuButton && (ariaLabel.includes('conversation options') || title.includes('conversation options'))) ||
      labels.some((label) =>
        ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
      );
    return matchesKnownButton && isVisible(element);
  };
  const listRoots = listSelectors
    .map((selector) => document.querySelector(selector))
    .filter((element) => element instanceof HTMLElement && isVisible(element));
  const searchRoots = listRoots.length ? listRoots : [document];
  const findTargetRow = () => {
    const rowEntry = searchRoots
      .flatMap((root) => Array.from(root.querySelectorAll('li')))
      .map((row) => ({ row, link: row.querySelector(':scope > a[href], a[href]') }))
      .find(({ row, link }) =>
        row instanceof HTMLElement &&
        isVisible(row) &&
        link instanceof HTMLAnchorElement &&
        isVisible(link) &&
        matchesConversationHref(link.href),
      );
    if (rowEntry?.row instanceof HTMLElement) {
      return rowEntry.row;
    }
    return null;
  };
  const tryClick = () => {
    const row = findTargetRow();
    if (!(row instanceof HTMLElement)) {
      return { done: true, result: { status: 'not_found' } };
    }
    const target = Array.from(
      row.querySelectorAll('button, [role="button"], [data-trailing-button], .__menu-item-trailing-btn'),
    ).find((element) => element instanceof HTMLElement && isConversationOptionsButton(element));
    if (target instanceof HTMLElement) {
      target.click();
      return { done: true, result: { status: 'clicked' } };
    }
    if (Date.now() >= deadline) {
      return { done: true, result: { status: 'pending' } };
    }
    return { done: false };
  };
  const tick = () => {
    const attempt = tryClick();
    if (attempt.done) {
      resolve(attempt.result);
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
}))()
`;
