import { ChatGptAutomationView } from './ChatGptAutomationView';
import {
  buildInspectConversationHtmlReadinessScript,
  type ExtractedConversationHtmlReadiness,
} from './chatGptConversationImportScripts';

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
  timeoutMs = 12_000,
  intervalMs = 180,
) => {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = '';
  let stableCount = 0;

  while (Date.now() < deadline && !automationView.isClosed()) {
    const snapshot = await automationView.execute<ExtractedConversationHtmlReadiness>(
      buildInspectConversationHtmlReadinessScript(),
    );

    const signature = [
      snapshot.readyState,
      snapshot.hasMain ? 'main' : 'nomain',
      snapshot.messageCount,
      Math.floor(snapshot.conversationHtmlLength / 500),
      snapshot.hasLoadingIndicator ? 'loading' : 'ready',
    ].join(':');

    if (snapshot.hasMain && snapshot.messageCount > 0) {
      stableCount = signature === lastSignature ? stableCount + 1 : 1;
      lastSignature = signature;
      if (!snapshot.hasLoadingIndicator && stableCount >= 2) {
        return true;
      }
      if (stableCount >= 4) {
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
