import { ACTIONABLE_SELECTOR } from './chatGptAutomationScripts';

export type ChatGptPageSnapshot = {
  actionLabels: string[];
  bodyText: string;
  currentUrl: string;
  title: string;
};

export type SharedUrlCandidateSnapshot = {
  currentUrl: string;
  matchedTextUrl: string | null;
  urls: string[];
};

export const buildGetPageSnapshotScript = () => `
(() => {
  const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const actionLabels = Array.from(document.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)}))
    .map((element) => clean(element.textContent || element.getAttribute('aria-label') || element.getAttribute('title')))
    .filter((value, index, items) => value && items.indexOf(value) === index)
    .slice(0, 24);
  return {
    actionLabels,
    bodyText: clean(document.body?.innerText || '').slice(0, 4000),
    currentUrl: window.location.href,
    title: document.title || '',
  };
})()
`;

export const buildGetSharedUrlCandidateScript = () => `
(() => {
  const pattern = /https:\\/\\/chatgpt\\.com\\/share\\/[\\w-]+/i;
  const normalize = (value) => typeof value === 'string' ? value.trim() : '';
  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = normalize(value);
    if (normalized) candidates.push(normalized);
  };
  const nodes = Array.from(
    document.querySelectorAll('input, textarea, a[href], button, [role="button"], [data-testid], [data-value]'),
  );
  for (const element of nodes) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      pushCandidate(element.value);
      pushCandidate(element.placeholder);
    }
    if (element instanceof HTMLAnchorElement) pushCandidate(element.href);
    if (element instanceof HTMLElement) {
      pushCandidate(element.getAttribute('data-value'));
      pushCandidate(element.getAttribute('value'));
      pushCandidate(element.getAttribute('aria-label'));
      pushCandidate(element.getAttribute('title'));
      pushCandidate(element.textContent);
    }
  }
  const bodyText = document.body?.innerText || '';
  const matchedTextUrl = bodyText.match(pattern)?.[0] ?? null;
  return { currentUrl: normalize(window.location.href), matchedTextUrl, urls: candidates };
})()
`;

