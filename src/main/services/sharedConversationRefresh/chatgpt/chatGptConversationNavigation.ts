import {
  CHATGPT_CHALLENGE_TEXT_MARKERS,
  CHATGPT_LOGIN_TEXT_MARKERS,
  CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
  CHATGPT_LOGIN_URL_PATTERNS,
  CHATGPT_MORE_BUTTON_LABELS,
  CHATGPT_MORE_BUTTON_TEST_IDS,
  CHATGPT_OPEN_SIDEBAR_BUTTON_LABELS,
  CHATGPT_PROJECTS_BUTTON_LABELS,
  CHATGPT_SHARE_BUTTON_LABELS,
  CHATGPT_SHARE_BUTTON_TEST_IDS,
} from './ChatGptDomSelectors';
import { ChatGptAutomationView } from './ChatGptAutomationView';
import { waitForConversationListReady } from './chatGptConversationLoadHelpers';
import { waitForFloatingMenuFromConversationRow } from './chatGptConversationMenuHelpers';
import {
  includesMarker,
  type ShareEntryPointResult,
} from './chatGptRefreshHelpers';

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

const isSamePage = (currentUrl: string, targetUrl: string) => {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    return (
      current.hostname === target.hostname &&
      current.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '')
    );
  } catch {
    return false;
  }
};

const openSidebarIfCollapsed = async (automationView: ChatGptAutomationView) => {
  const hasOpenSidebarButton = await automationView.hasButtonByLabels(
    CHATGPT_OPEN_SIDEBAR_BUTTON_LABELS,
  );
  if (!hasOpenSidebarButton) {
    return;
  }

  await automationView.waitAndClickButtonByLabels(
    CHATGPT_OPEN_SIDEBAR_BUTTON_LABELS,
    [],
    2_000,
    120,
  );
  await sleep(300);
};

const buildFailure = (
  lastLoginLikeState: string,
  lastSnapshot: Awaited<ReturnType<ChatGptAutomationView['getPageSnapshot']>>,
): ShareEntryPointResult =>
  lastLoginLikeState
    ? { detail: lastLoginLikeState, status: 'login_required' }
    : {
        detail: `${lastSnapshot.currentUrl}\nvisible actions: ${lastSnapshot.actionLabels.join(' | ')}`,
        status: 'share_button_not_found',
      };

const waitForConversationRowShareEntryPoint = async (
  automationView: ChatGptAutomationView,
  chatUrl: string,
  deadline: number,
  intervalMs: number,
  initialSnapshot: Awaited<ReturnType<ChatGptAutomationView['getPageSnapshot']>>,
  initialLoginState: string,
  listHoverSelectors?: string[],
) => {
  let lastSnapshot = initialSnapshot;
  let lastLoginLikeState = initialLoginState;
  let shouldPrimeListHover = Boolean(listHoverSelectors?.length);

  while (Date.now() < deadline && !automationView.isClosed()) {
    if (shouldPrimeListHover && listHoverSelectors?.length) {
      const isListReady = await waitForConversationListReady(
        automationView,
        listHoverSelectors,
      );
      if (!isListReady) {
        await sleep(intervalMs);
        continue;
      }
      const listHoverPoint = await automationView.getHoverPointForSelectors(listHoverSelectors);
      if (listHoverPoint) {
        await automationView.moveMouse(listHoverPoint.x, listHoverPoint.y);
        await sleep(70);
      }
      shouldPrimeListHover = false;
    }

    const rowMenuStep = await automationView.stepConversationRowMenuByChatUrl(
      chatUrl,
      CHATGPT_MORE_BUTTON_LABELS,
      CHATGPT_MORE_BUTTON_TEST_IDS,
      listHoverSelectors ?? [],
    );
    if (rowMenuStep.status === 'clicked') {
      const shareMenuState = await waitForFloatingMenuFromConversationRow(
        automationView,
        chatUrl,
        listHoverSelectors ?? [],
      );
      if (shareMenuState === 'window_closed') {
        return {
          detail: lastSnapshot.currentUrl,
          status: 'window_closed',
        };
      }
      if (shareMenuState === 'scrolled') {
        shouldPrimeListHover = Boolean(listHoverSelectors?.length);
        continue;
      }
      if (shareMenuState !== 'opened') {
        await sleep(intervalMs);
        continue;
      }
      const clickedShare = await automationView.waitAndClickFloatingButtonByLabels(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
        2_000,
        120,
      );
      if (clickedShare) {
        return { status: 'opened' } satisfies ShareEntryPointResult;
      }
    }

    lastSnapshot = await automationView.getPageSnapshot();
    if (isLoginLikeSnapshot(lastSnapshot)) {
      lastLoginLikeState = lastSnapshot.currentUrl || lastSnapshot.title;
    }

    if (rowMenuStep.status === 'hovered') {
      const shareMenuState = await waitForFloatingMenuFromConversationRow(
        automationView,
        chatUrl,
        listHoverSelectors ?? [],
        { x: rowMenuStep.x, y: rowMenuStep.y },
      );
      if (shareMenuState === 'window_closed') {
        return {
          detail: lastSnapshot.currentUrl,
          status: 'window_closed',
        };
      }
      if (shareMenuState === 'scrolled') {
        shouldPrimeListHover = Boolean(listHoverSelectors?.length);
        continue;
      }
      if (shareMenuState !== 'opened') {
        await sleep(intervalMs);
        continue;
      }
      const clickedShare = await automationView.waitAndClickFloatingButtonByLabels(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
        2_000,
        120,
      );
      if (clickedShare) {
        return { status: 'opened' } satisfies ShareEntryPointResult;
      }
      continue;
    }

    if (rowMenuStep.status === 'scrolled') {
      shouldPrimeListHover = Boolean(listHoverSelectors?.length);
      continue;
    }

    await sleep(intervalMs);
  }

  if (automationView.isClosed()) {
    return {
      detail: lastSnapshot.currentUrl,
      status: 'window_closed',
    };
  }

  return buildFailure(lastLoginLikeState, lastSnapshot);
};

const openProjectPage = async (
  automationView: ChatGptAutomationView,
  projectUrl: string,
  deadline: number,
  intervalMs: number,
) => {
  while (Date.now() < deadline && !automationView.isClosed()) {
    const snapshot = await automationView.getPageSnapshot();
    if (isSamePage(snapshot.currentUrl, projectUrl)) {
      return snapshot;
    }

    await openSidebarIfCollapsed(automationView);
    const openedProject = await automationView.tryClickLinkByUrl(projectUrl);
    if (!openedProject) {
      await automationView.waitAndClickButtonByLabels(
        CHATGPT_PROJECTS_BUTTON_LABELS,
        [],
        1_200,
        120,
      );
    }

    await sleep(openedProject ? 250 : intervalMs);
  }

  return automationView.isClosed() ? 'window_closed' : null;
};

export const openShareEntryPointFromSidebar = async (
  automationView: ChatGptAutomationView,
  chatUrl: string,
  timeoutMs = 120_000,
  intervalMs = 120,
) => {
  const deadline = Date.now() + timeoutMs;
  const snapshot = await automationView.getPageSnapshot();
  const loginState = isLoginLikeSnapshot(snapshot)
    ? snapshot.currentUrl || snapshot.title
    : '';

  await openSidebarIfCollapsed(automationView);
  return waitForConversationRowShareEntryPoint(
    automationView,
    chatUrl,
    deadline,
    intervalMs,
    snapshot,
    loginState,
  );
};

export const openShareEntryPointFromProject = async (
  automationView: ChatGptAutomationView,
  projectUrl: string,
  chatUrl: string,
  timeoutMs = 120_000,
  intervalMs = 120,
) => {
  const deadline = Date.now() + timeoutMs;
  const firstSnapshot = await automationView.getPageSnapshot();
  const loginState = isLoginLikeSnapshot(firstSnapshot)
    ? firstSnapshot.currentUrl || firstSnapshot.title
    : '';

  const projectSnapshot = await openProjectPage(
    automationView,
    projectUrl,
    deadline,
    intervalMs,
  );
  if (projectSnapshot === 'window_closed') {
    return {
      detail: firstSnapshot.currentUrl,
      status: 'window_closed',
    };
  }
  if (!projectSnapshot) {
    const snapshot = await automationView.getPageSnapshot();
    return buildFailure(loginState, snapshot);
  }

  return waitForConversationRowShareEntryPoint(
    automationView,
    chatUrl,
    deadline,
    intervalMs,
    projectSnapshot,
    loginState,
    CHATGPT_PROJECT_CHAT_LIST_SELECTORS,
  );
};
