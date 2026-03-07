import { clipboard } from 'electron';
import {
  CHATGPT_COPY_SUCCESS_TEXT_MARKERS,
  CHATGPT_SHARE_URL_PATTERN,
  CHATGPT_SHARE_BUTTON_LABELS,
  CHATGPT_SHARE_BUTTON_TEST_IDS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
  CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
} from './ChatGptDomSelectors';
import { ChatGptAutomationView } from './ChatGptAutomationView';
import { buildHasFloatingButtonScript } from './chatGptAutomationScripts';

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
  | { status: 'window_closed' };

export type ShareEntryPointResult =
  | { status: 'opened' }
  | { status: 'login_required'; detail: string }
  | { status: 'share_button_not_found'; detail: string }
  | { status: 'window_closed'; detail?: string };

export type ShareModalOpenResult = 'opened' | 'window_closed';
export type ShareActionMenuOpenResult = 'opened' | 'timeout' | 'window_closed';

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
    const hasDialog = await automationView.hasVisibleDialog();
    const hasCopyAction = await automationView.hasButtonByLabels(
      CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
      CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
    );
    if (hasDialog || hasCopyAction) {
      return 'opened';
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
    const hasShareAction = await automationView.execute<boolean>(
      buildHasFloatingButtonScript(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
      ),
    );
    if (hasShareAction) {
      return 'opened';
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return automationView.isClosed() ? 'window_closed' : 'timeout';
};

export const waitForShareCopyResolution = async (
  automationView: ChatGptAutomationView,
  intervalMs = 250,
): Promise<ShareCopyResolution> => {
  let clickedActionAbove = false;
  let clickedCopy = false;
  let copyConfirmed = false;

  while (!automationView.isClosed()) {
    if (!clickedCopy) {
      clickedCopy = await automationView.tryClickButtonByLabels(
        CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
        CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
      );

      if (!clickedCopy) {
        const hasCopyAction = await automationView.hasButtonByLabels(
          CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
          CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
        );
        if (hasCopyAction && !clickedActionAbove) {
          clickedActionAbove =
            await automationView.tryClickActionAboveButtonByLabels(
              CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
              CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
            );
        }
      }
    }

    if (clickedCopy && !copyConfirmed) {
      copyConfirmed = await automationView.hasTextMarkers(
        CHATGPT_COPY_SUCCESS_TEXT_MARKERS,
      );
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

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { status: 'window_closed' };
};
