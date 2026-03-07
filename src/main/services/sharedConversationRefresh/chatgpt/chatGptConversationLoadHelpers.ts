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
