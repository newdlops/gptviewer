import {
  CHATGPT_COPY_SUCCESS_TEXT_MARKERS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
} from './ChatGptDomSelectors';
import { ChatGptAutomationView } from './ChatGptAutomationView';

const CHATGPT_SHARE_MODAL_DISMISS_LABELS = [
  '닫기',
  '취소',
  'cancel',
  'close',
  'done',
];

export type ShareModalProgressSnapshot = {
  hasCopyAction: boolean;
  hasCopySuccess: boolean;
  hasDialog: boolean;
  hasEnabledCopyAction: boolean;
  hasSharedUrlCandidate: boolean;
  signature: string;
};

export const getShareModalProgressSnapshot = async (
  automationView: ChatGptAutomationView,
): Promise<ShareModalProgressSnapshot> =>
  automationView.execute<ShareModalProgressSnapshot>(`
    (() => {
      const labels = ${JSON.stringify(CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS)}
        .map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());
      const testIds = new Set(${JSON.stringify(CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS)});
      const successMarkers = ${JSON.stringify(CHATGPT_COPY_SUCCESS_TEXT_MARKERS)}
        .map((value) => value.toLowerCase());
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
      };
      const isEnabled = (element) => {
        if (!(element instanceof HTMLElement)) return true;
        const style = window.getComputedStyle(element);
        const ariaDisabled = normalize(element.getAttribute('aria-disabled')) === 'true';
        const dataDisabled = normalize(element.getAttribute('data-disabled')) === 'true';
        const nativeDisabled = 'disabled' in element ? Boolean(element.disabled) : false;
        return !ariaDisabled && !dataDisabled && !nativeDisabled && style.pointerEvents !== 'none';
      };
      const dialogRoots = Array.from(
        document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-radix-popper-content-wrapper]')
      ).filter((element) => isVisible(element));
      const scopes = dialogRoots.length > 0 ? dialogRoots : [document.body];
      const candidates = scopes.flatMap((scope) =>
        Array.from(scope.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="option"], [data-testid]')),
      );
      const copyAction = candidates.find((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
        const text = normalize(element.textContent);
        const ariaLabel = normalize(element.getAttribute('aria-label'));
        const title = normalize(element.getAttribute('title'));
        const testId = normalize(element.getAttribute('data-testid'));
        if (testIds.has(testId)) return true;
        return labels.some((label) =>
          text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
        );
      });
      const dialogText = scopes
        .map((scope) => normalize(scope instanceof HTMLElement ? scope.innerText : ''))
        .join(' ')
        .slice(0, 400);
      const hasSharedUrlCandidate = scopes.some((scope) =>
        Array.from(scope.querySelectorAll('input, textarea, a[href]')).some((element) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return /https:\\/\\/chatgpt\\.com\\/share\\/[\\w-]+/i.test(element.value || '');
          }
          if (element instanceof HTMLAnchorElement) {
            return /https:\\/\\/chatgpt\\.com\\/share\\/[\\w-]+/i.test(element.href || '');
          }
          return false;
        }),
      );
      const hasCopySuccess = successMarkers.some((marker) => dialogText.includes(marker));
      return {
        hasCopyAction: Boolean(copyAction),
        hasCopySuccess,
        hasDialog: dialogRoots.length > 0,
        hasEnabledCopyAction: Boolean(copyAction) && isEnabled(copyAction),
        hasSharedUrlCandidate,
        signature: [
          dialogRoots.length,
          Boolean(copyAction) ? 'copy' : 'no-copy',
          Boolean(copyAction) && isEnabled(copyAction) ? 'enabled' : 'disabled',
          hasSharedUrlCandidate ? 'url' : 'no-url',
          hasCopySuccess ? 'success' : 'pending',
          dialogText,
        ].join('|'),
      };
    })()
  `);

export const tryDismissVisibleShareModal = async (
  automationView: ChatGptAutomationView,
) =>
  automationView.execute<boolean>(`
    (() => {
      const labels = ${JSON.stringify(CHATGPT_SHARE_MODAL_DISMISS_LABELS)}
        .map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
      };
      const roots = Array.from(
        document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-radix-popper-content-wrapper]')
      ).filter((element) => isVisible(element));
      for (const root of roots) {
        const target = Array.from(root.querySelectorAll('button, a, [role="button"]')).find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const text = normalize(element.textContent);
          const ariaLabel = normalize(element.getAttribute('aria-label'));
          const title = normalize(element.getAttribute('title'));
          return labels.some((label) =>
            text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
          );
        });
        if (target instanceof HTMLElement) {
          target.click();
          return true;
        }
      }
      return false;
    })()
  `);

export const sendEscapeToAutomationWindow = (
  automationView: ChatGptAutomationView,
) => {
  automationView.webContents.sendInputEvent({ keyCode: 'Escape', type: 'keyDown' });
  automationView.webContents.sendInputEvent({ keyCode: 'Escape', type: 'keyUp' });
};
