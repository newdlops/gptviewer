import {
  CHATGPT_CHALLENGE_TEXT_MARKERS,
  CHATGPT_CLOSE_SIDEBAR_BUTTON_LABELS,
  CHATGPT_LOGIN_TEXT_MARKERS,
  CHATGPT_LOGIN_URL_PATTERNS,
  CHATGPT_SHARE_BUTTON_LABELS,
  CHATGPT_SHARE_BUTTON_TEST_IDS,
} from './ChatGptDomSelectors';
import { ChatGptAutomationView } from './ChatGptAutomationView';
import {
  buildActivateHeaderShareButtonScript,
  buildGetHeaderShareButtonPointScript,
} from './chatGptDirectConversationScripts';
import { includesMarker, type ShareEntryPointResult } from './chatGptRefreshHelpers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isLoginLikeSnapshot = (
  snapshot: Awaited<ReturnType<ChatGptAutomationView['getPageSnapshot']>>,
) => {
  const isLoginUrl = CHATGPT_LOGIN_URL_PATTERNS.some((pattern) =>
    pattern.test(snapshot.currentUrl),
  );
  return (
    isLoginUrl ||
    includesMarker(snapshot.bodyText, CHATGPT_LOGIN_TEXT_MARKERS) ||
    includesMarker(snapshot.bodyText, CHATGPT_CHALLENGE_TEXT_MARKERS)
  );
};

const isSameConversationPage = (currentUrl: string, targetUrl: string) => {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    const currentPath = current.pathname.replace(/\/$/, '');
    const targetPath = target.pathname.replace(/\/$/, '');
    return current.hostname === target.hostname && currentPath === targetPath;
  } catch {
    return false;
  }
};

export const openShareEntryPointFromDirectConversation = async (
  automationView: ChatGptAutomationView,
  chatUrl: string,
  timeoutMs = 120_000,
  intervalMs = 120,
): Promise<ShareEntryPointResult> => {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = await automationView.getPageSnapshot();
  let attemptedSidebarClose = false;

  while (Date.now() < deadline && !automationView.isClosed()) {
    lastSnapshot = await automationView.getPageSnapshot();

    if (isLoginLikeSnapshot(lastSnapshot)) {
      return {
        detail: lastSnapshot.currentUrl || lastSnapshot.title,
        status: 'login_required',
      };
    }

    if (!isSameConversationPage(lastSnapshot.currentUrl, chatUrl)) {
      await sleep(intervalMs);
      continue;
    }

    const activatedShare = await automationView.execute<boolean>(
      buildActivateHeaderShareButtonScript(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
      ),
    );
    if (activatedShare) {
      return { status: 'opened' };
    }

    const sharePoint = await automationView.execute<{ x: number; y: number } | null>(
      buildGetHeaderShareButtonPointScript(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
      ),
    );
    if (sharePoint) {
      await automationView.moveMouse(sharePoint.x, sharePoint.y);
      automationView.webContents.sendInputEvent({
        button: 'left',
        clickCount: 1,
        type: 'mouseDown',
        x: sharePoint.x,
        y: sharePoint.y,
      });
      automationView.webContents.sendInputEvent({
        button: 'left',
        clickCount: 1,
        type: 'mouseUp',
        x: sharePoint.x,
        y: sharePoint.y,
      });
      return { status: 'opened' };
    }

    if (!attemptedSidebarClose) {
      attemptedSidebarClose = await automationView.waitAndClickButtonByLabels(
        CHATGPT_CLOSE_SIDEBAR_BUTTON_LABELS,
        [],
        800,
        100,
      );
      if (attemptedSidebarClose) {
        await sleep(180);
        continue;
      }
    }

    await sleep(intervalMs);
  }

  if (automationView.isClosed()) {
    return {
      detail: lastSnapshot.currentUrl,
      status: 'window_closed',
    };
  }

  return {
    detail: `${lastSnapshot.currentUrl}\nvisible actions: ${lastSnapshot.actionLabels.join(' | ')}`,
    status: 'share_button_not_found',
  };
};
