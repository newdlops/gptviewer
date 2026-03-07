import {
  CHATGPT_CHALLENGE_TEXT_MARKERS,
  CHATGPT_CLOSE_SIDEBAR_BUTTON_LABELS,
  CHATGPT_LOGIN_TEXT_MARKERS,
  CHATGPT_LOGIN_URL_PATTERNS,
  CHATGPT_SHARE_BUTTON_LABELS,
  CHATGPT_SHARE_BUTTON_TEST_IDS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
} from './ChatGptDomSelectors';
import { ChatGptAutomationView } from './ChatGptAutomationView';
import { waitForDirectConversationReady } from './chatGptConversationLoadHelpers';
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

const waitForShareModalSignalAfterClick = async (
  automationView: ChatGptAutomationView,
  timeoutMs = 2_000,
  intervalMs = 80,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !automationView.isClosed()) {
    const hasDialog = await automationView.hasVisibleDialog();
    const hasCopyAction = await automationView.hasButtonByLabels(
      CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
      CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
    );
    if (hasDialog || hasCopyAction) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
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
  let lastSharePointKey = '';
  let stableSharePointCount = 0;

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

    const conversationReady = await waitForDirectConversationReady(
      automationView,
      6_000,
      180,
    );
    if (!conversationReady) {
      await sleep(intervalMs);
      continue;
    }

    const sharePoint = await automationView.execute<{ x: number; y: number } | null>(
      buildGetHeaderShareButtonPointScript(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
      ),
    );
    if (sharePoint) {
      const pointKey = `${sharePoint.x}:${sharePoint.y}`;
      stableSharePointCount =
        pointKey === lastSharePointKey ? stableSharePointCount + 1 : 1;
      lastSharePointKey = pointKey;
      if (stableSharePointCount < 2) {
        await sleep(intervalMs);
        continue;
      }

      const activatedShare = await automationView.execute<boolean>(
        buildActivateHeaderShareButtonScript(
          CHATGPT_SHARE_BUTTON_LABELS,
          CHATGPT_SHARE_BUTTON_TEST_IDS,
        ),
      );
      if (!activatedShare) {
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
      }
      const modalOpened = await waitForShareModalSignalAfterClick(
        automationView,
        Math.max(Math.min(deadline - Date.now(), 8_000), 1_000),
        80,
      );
      if (modalOpened) {
        return { status: 'opened' };
      }
      await sleep(intervalMs);
      continue;
    }

    lastSharePointKey = '';
    stableSharePointCount = 0;

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
