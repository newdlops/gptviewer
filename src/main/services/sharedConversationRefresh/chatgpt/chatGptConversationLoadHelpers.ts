import { ChatGptAutomationView } from './ChatGptAutomationView';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForConversationListReady = async (
  automationView: ChatGptAutomationView,
  selectors: string[],
  timeoutMs = 4_000,
  intervalMs = 80,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !automationView.isClosed()) {
    const isReady = await automationView.execute<boolean>(`
      (() => {
        const selectors = ${JSON.stringify(selectors)};
        const isVisible = (element) => element instanceof HTMLElement && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && window.getComputedStyle(element).display !== 'none' && window.getComputedStyle(element).visibility !== 'hidden' && !element.hasAttribute('hidden');
        if (document.readyState === 'loading') return false;
        return selectors.some((selector) => {
          const root = document.querySelector(selector);
          return isVisible(root) && root.querySelectorAll('li > a[href], li a[href]').length > 0;
        });
      })()
    `);
    if (isReady) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
};

export const waitForDirectConversationReady = async (
  automationView: ChatGptAutomationView,
  timeoutMs = 8_000,
  intervalMs = 160,
) => {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = '';
  let stableCount = 0;

  while (Date.now() < deadline && !automationView.isClosed()) {
    const snapshot = await automationView.execute<{
      hasLoadingIndicator: boolean;
      messageCount: number;
      readyState: string;
      textLength: number;
    }>(`
      (() => {
        const isVisible = (element) => element instanceof HTMLElement && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && window.getComputedStyle(element).display !== 'none' && window.getComputedStyle(element).visibility !== 'hidden' && !element.hasAttribute('hidden');
        const main = document.querySelector('main') || document.body;
        const messageNodes = Array.from(main.querySelectorAll('article, [data-message-author-role], [data-testid*="message"], [data-testid*="conversation-turn"]'))
          .filter((element) => isVisible(element));
        const textLength = (main?.innerText || '').replace(/\\s+/g, ' ').trim().length;
        const hasLoadingIndicator = Array.from(document.querySelectorAll('[role="progressbar"], .animate-spin, [data-testid*="loading"], [aria-busy="true"]'))
          .some((element) => isVisible(element));
        return {
          hasLoadingIndicator,
          messageCount: messageNodes.length,
          readyState: document.readyState,
          textLength,
        };
      })()
    `);

    const signature = [
      snapshot.readyState,
      snapshot.messageCount,
      Math.floor(snapshot.textLength / 80),
      snapshot.hasLoadingIndicator ? 'loading' : 'ready',
    ].join(':');

    if (
      snapshot.readyState !== 'loading' &&
      snapshot.messageCount > 0 &&
      snapshot.textLength > 120 &&
      !snapshot.hasLoadingIndicator
    ) {
      stableCount = signature === lastSignature ? stableCount + 1 : 1;
      lastSignature = signature;
      if (stableCount >= 3) {
        return true;
      }
    } else {
      lastSignature = '';
      stableCount = 0;
    }

    await sleep(intervalMs);
  }

  return false;
};
