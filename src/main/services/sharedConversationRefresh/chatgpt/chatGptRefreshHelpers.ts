import { clipboard } from 'electron';
import {
  CHATGPT_SHARE_URL_PATTERN,
  CHATGPT_SHARE_BUTTON_LABELS,
  CHATGPT_SHARE_BUTTON_TEST_IDS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
} from './ChatGptDomSelectors';
import { ChatGptAutomationView } from './ChatGptAutomationView';
import { buildHasFloatingButtonScript } from './chatGptAutomationScripts';
import { focusAutomationWindow } from './chatGptAutomationWindowFocus';
import {
  getShareModalProgressSnapshot,
  sendEscapeToAutomationWindow,
  tryDismissVisibleShareModal,
} from './chatGptShareModalState';

export const readSharedUrlFromClipboard = async (timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clipboardUrl = readSharedUrlFromClipboardOnce();
    if (clipboardUrl) {
      return clipboardUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
};

export const readSharedUrlFromClipboardOnce = () => {
  const clipboardText = clipboard.readText().trim();
  return CHATGPT_SHARE_URL_PATTERN.test(clipboardText)
    ? clipboardText
    : null;
};

export const includesMarker = (value: string, markers: string[]) => {
  const normalizedValue = value.toLowerCase();
  return markers.some((marker) => normalizedValue.includes(marker));
};

export type ShareCopyResolution =
  | { status: 'copied'; shareUrl?: string }
  | { status: 'stalled' }
  | { status: 'window_closed' };

export type ShareEntryPointResult =
  | { status: 'opened' }
  | { status: 'login_required'; detail: string }
  | { status: 'share_button_not_found'; detail: string }
  | { status: 'window_closed'; detail?: string };

export type ShareModalOpenResult = 'opened' | 'window_closed';
export type ShareActionMenuOpenResult = 'opened' | 'timeout' | 'window_closed';
export type CloseShareModalResult = 'closed' | 'timeout' | 'window_closed';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const resolveRefreshedShareUrl = async (
  automationView: ChatGptAutomationView,
) => {
  const clipboardUrl = await readSharedUrlFromClipboard(5_000);
  if (clipboardUrl) {
    return clipboardUrl;
  }

  const domUrl = await automationView.waitForSharedUrlCandidate(8_000);
  if (domUrl) {
    return domUrl;
  }

  return null;
};

export const waitForShareModalOpen = async (
  automationView: ChatGptAutomationView,
  intervalMs = 250,
): Promise<ShareModalOpenResult> => {
  while (!automationView.isClosed()) {
    focusAutomationWindow(automationView);
    const hasDialog = await automationView.hasVisibleDialog();
    const hasCopyAction = await automationView.hasButtonByLabels(
      CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
      CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
    );
    if (hasDialog || hasCopyAction) {
      return 'opened';
    }

    await sleep(intervalMs);
  }

  return 'window_closed';
};

export const waitForShareActionMenuOpen = async (
  automationView: ChatGptAutomationView,
  timeoutMs = 4_000,
  intervalMs = 80,
): Promise<ShareActionMenuOpenResult> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !automationView.isClosed()) {
    focusAutomationWindow(automationView);
    const hasShareAction = await automationView.execute<boolean>(
      buildHasFloatingButtonScript(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
      ),
    );
    if (hasShareAction) {
      return 'opened';
    }
    await sleep(intervalMs);
  }

  return automationView.isClosed() ? 'window_closed' : 'timeout';
};

export const closeShareModal = async (
  automationView: ChatGptAutomationView,
  timeoutMs = 2_000,
  intervalMs = 100,
): Promise<CloseShareModalResult> => {
  const deadline = Date.now() + timeoutMs;
  let attemptedDismissClick = false;

  while (Date.now() < deadline && !automationView.isClosed()) {
    focusAutomationWindow(automationView);
    sendEscapeToAutomationWindow(automationView);
    await sleep(Math.min(intervalMs, 120));

    const progress = await getShareModalProgressSnapshot(automationView);
    if (!progress.hasDialog && !progress.hasCopyAction) {
      return 'closed';
    }

    if (!attemptedDismissClick) {
      attemptedDismissClick = await tryDismissVisibleShareModal(automationView);
    }

    await sleep(intervalMs);
  }

  return automationView.isClosed() ? 'window_closed' : 'timeout';
};

export const waitForShareCopyResolution = async (
  automationView: ChatGptAutomationView,
  intervalMs = 250,
  idleTimeoutMs = 2_000,
): Promise<ShareCopyResolution> => {
  let clickedActionAbove = false;
  let clickedCopy = false;
  let copyConfirmed = false;
  let lastProgressAt = Date.now();
  let lastProgressSignature = '';

  while (!automationView.isClosed()) {
    focusAutomationWindow(automationView);
    const progress = await getShareModalProgressSnapshot(automationView);
    const progressSignature = [
      progress.signature,
      clickedActionAbove ? 'action-above' : 'idle',
      clickedCopy ? 'copy-clicked' : 'copy-pending',
      copyConfirmed ? 'copy-confirmed' : 'copy-unconfirmed',
    ].join('|');
    if (progressSignature !== lastProgressSignature) {
      lastProgressSignature = progressSignature;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt >= idleTimeoutMs) {
      return { status: 'stalled' };
    }

    if (progress.hasCopySuccess) {
      copyConfirmed = true;
    }

    if (!clickedCopy) {
      if (progress.hasEnabledCopyAction) {
        clickedCopy = await automationView.tryClickButtonByLabels(
          CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
          CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
        );
      }

      if (!clickedCopy && progress.hasCopyAction && !clickedActionAbove) {
        clickedActionAbove =
          await automationView.tryClickActionAboveButtonByLabels(
            CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
            CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
          );
      }
    }

    if (clickedCopy && !copyConfirmed && progress.hasCopySuccess) {
      copyConfirmed = true;
    }

    if (copyConfirmed) {
      const clipboardUrl = readSharedUrlFromClipboardOnce();
      if (clipboardUrl) {
        return { shareUrl: clipboardUrl, status: 'copied' };
      }

      const shareUrlFromModal = await automationView.getSharedUrlCandidate();
      if (shareUrlFromModal) {
        return { shareUrl: shareUrlFromModal, status: 'copied' };
      }
    }

    await sleep(intervalMs);
  }

  return { status: 'window_closed' };
};
