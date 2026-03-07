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
import { getShareModalProgressSnapshot, sendEscapeToAutomationWindow, tryDismissVisibleShareModal } from './chatGptShareModalState';
import type { ChatGptRefreshDiagnostics } from './chatGptRefreshDiagnostics';
import { extractSuccessfulShareUpdateUrl, type ChatGptShareNetworkEvent } from './chatGptShareResponseBridgeScripts';

export const readSharedUrlFromClipboard = async (timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clipboardUrl = readSharedUrlFromClipboardOnce();
    if (clipboardUrl) return clipboardUrl;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
};
export const readSharedUrlFromClipboardOnce = () => {
  const clipboardText = clipboard.readText().trim();
  return CHATGPT_SHARE_URL_PATTERN.test(clipboardText) ? clipboardText : null;
};

const readSharedUrlFromBridgedClipboard = async (automationView: ChatGptAutomationView) => {
  const bridgedClipboardText = (await automationView.getBridgedClipboardText()).trim();
  return CHATGPT_SHARE_URL_PATTERN.test(bridgedClipboardText) ? bridgedClipboardText : null;
};

const readSharedUrlFromResponseBridge = async (automationView: ChatGptAutomationView) => {
  const bridgedResponseUrl = (await automationView.getBridgedShareResponseUrl()).trim();
  return CHATGPT_SHARE_URL_PATTERN.test(bridgedResponseUrl) ? bridgedResponseUrl : null;
};
export const includesMarker = (value: string, markers: string[]) =>
  markers.some((marker) => value.toLowerCase().includes(marker));

export type ShareCopyResolution = { status: 'copied'; shareUrl?: string } | { status: 'stalled' } | { status: 'window_closed' };
export type ShareEntryPointResult = { status: 'opened' } | { status: 'login_required'; detail: string } | { status: 'share_button_not_found'; detail: string } | { status: 'window_closed'; detail?: string };

export type ShareModalOpenResult = 'opened' | 'window_closed';
export type ShareActionMenuOpenResult = 'opened' | 'timeout' | 'window_closed';
export type CloseShareModalResult = 'closed' | 'timeout' | 'window_closed';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const formatNetworkEvents = (events: ChatGptShareNetworkEvent[]) =>
  events.map((event) =>
    `${event.transport}:${event.phase}:${event.method}:${event.status ?? '-'}:${event.url}${event.shareUrl ? ` -> ${event.shareUrl}` : ''}`,
  );
export const resolveRefreshedShareUrl = async (automationView: ChatGptAutomationView) =>
  (await readSharedUrlFromClipboard(5_000)) ??
  (await automationView.waitForSharedUrlCandidate(8_000)) ??
  null;

export const waitForShareModalOpen = async (
  automationView: ChatGptAutomationView,
  intervalMs = 250,
  diagnostics?: ChatGptRefreshDiagnostics,
): Promise<ShareModalOpenResult> => {
  while (!automationView.isClosed()) {
    const hasDialog = await automationView.hasVisibleDialog();
    const hasCopyAction = await automationView.hasButtonByLabels(
      CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
      CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
    );
    diagnostics?.record('share-modal-open', `dialog=${hasDialog ? 'y' : 'n'} copyAction=${hasCopyAction ? 'y' : 'n'}`);
    if (hasDialog || hasCopyAction) return 'opened';
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
    const hasShareAction = await automationView.execute<boolean>(
      buildHasFloatingButtonScript(
        CHATGPT_SHARE_BUTTON_LABELS,
        CHATGPT_SHARE_BUTTON_TEST_IDS,
      ),
    );
    if (hasShareAction) return 'opened';
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
    sendEscapeToAutomationWindow(automationView);
    await sleep(Math.min(intervalMs, 120));

    const progress = await getShareModalProgressSnapshot(automationView);
    if (!progress.hasDialog && !progress.hasCopyAction) return 'closed';
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
  diagnostics?: ChatGptRefreshDiagnostics,
): Promise<ShareCopyResolution> => {
  await automationView.clearBridgedClipboardText();
  await automationView.clearBridgedShareResponseUrl();
  await automationView.clearShareNetworkEvents();
  let clickedActionAbove = false;
  let clickedCopy = false;
  let clickedCopyAt = 0;
  let copyConfirmed = false;
  let copyConfirmedAt = 0;
  let backendShareUpdateDetectedAt = 0;
  let lastProgressAt = Date.now();
  let lastProgressSignature = '';
  let pendingShareUrl: string | null = null;
  let pendingShareUrlSource = '';

  while (!automationView.isClosed()) {
    const capturePendingShareUrl = (value: string | null, source: string) => {
      if (!value || pendingShareUrl === value) return;
      pendingShareUrl = value;
      pendingShareUrlSource = source;
      lastProgressAt = Date.now();
      diagnostics?.record('share-copy', `captured share url candidate from ${source}`);
    };
    capturePendingShareUrl(readSharedUrlFromClipboardOnce(), 'system clipboard');
    if (clickedActionAbove || clickedCopy || copyConfirmed) {
      capturePendingShareUrl(await readSharedUrlFromBridgedClipboard(automationView), 'bridged clipboard');
      capturePendingShareUrl(await readSharedUrlFromResponseBridge(automationView), 'network response bridge');
      const shareNetworkEvents = await automationView.getShareNetworkEvents();
      const successfulShareUpdateUrl = extractSuccessfulShareUpdateUrl(shareNetworkEvents);
      if (successfulShareUpdateUrl) {
        capturePendingShareUrl(successfulShareUpdateUrl, 'backend share update response');
        if (!backendShareUpdateDetectedAt) {
          backendShareUpdateDetectedAt = Date.now();
          diagnostics?.record(
            'share-copy',
            'backend share update detected, waiting for copy confirmation',
          );
        }
      }
    }

    const progress = await getShareModalProgressSnapshot(automationView);
    diagnostics?.recordProgress('share-copy-progress', progress);
    if (progress.hasSharedUrlCandidate) {
      capturePendingShareUrl(
        await automationView.getSharedUrlCandidate(),
        'modal DOM',
      );
    }
    const progressSignature = [
      progress.signature,
      clickedActionAbove ? 'action-above' : 'idle',
      clickedCopy ? 'copy-clicked' : 'copy-pending',
      copyConfirmed ? 'copy-confirmed' : 'copy-unconfirmed',
      pendingShareUrl ? `url:${pendingShareUrlSource}` : 'url:pending',
    ].join('|');
    if (progressSignature !== lastProgressSignature) {
      lastProgressSignature = progressSignature;
      lastProgressAt = Date.now();
    } else if (
      (!copyConfirmed && Date.now() - lastProgressAt >= idleTimeoutMs) ||
      (copyConfirmedAt && Date.now() - copyConfirmedAt >= idleTimeoutMs)
    ) {
      const shareNetworkEvents = await automationView.getShareNetworkEvents();
      if (shareNetworkEvents.length > 0) {
        diagnostics?.record('share-network', formatNetworkEvents(shareNetworkEvents).join(' || '));
      } else {
        diagnostics?.record('share-network', 'no fetch/xhr events captured');
      }
      diagnostics?.record(
        'share-copy',
        copyConfirmedAt
          ? `copy confirmed but no share url after ${idleTimeoutMs}ms focus=${progress.hasDocumentFocus ? 'y' : 'n'} visibility=${progress.visibilityState}`
          : `stalled after ${idleTimeoutMs}ms focus=${progress.hasDocumentFocus ? 'y' : 'n'} visibility=${progress.visibilityState}`,
      );
      return { status: 'stalled' };
    }

    if (progress.hasCopySuccess) {
      copyConfirmed = true;
      if (!copyConfirmedAt) {
        copyConfirmedAt = Date.now();
        diagnostics?.record('share-copy', 'copy success marker detected');
      }
    }

    if (!clickedCopy) {
      if (progress.hasEnabledCopyAction) {
        const copyButtonPoint = await automationView.getButtonPointByLabels(
          CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
          CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
        );
        diagnostics?.record('share-copy', copyButtonPoint ? `copy button point found x=${copyButtonPoint.x} y=${copyButtonPoint.y}` : 'copy button point not found');
        clickedCopy = copyButtonPoint ? await automationView.clickAt(copyButtonPoint.x, copyButtonPoint.y) : false;
        if (clickedCopy && !clickedCopyAt) {
          clickedCopyAt = Date.now();
          await automationView.clearBridgedClipboardText();
          await automationView.clearBridgedShareResponseUrl();
          await automationView.clearShareNetworkEvents();
          diagnostics?.record('share-copy', `clicked copy action via input focus=${progress.hasDocumentFocus ? 'y' : 'n'} visibility=${progress.visibilityState}`);
        }
      }

      if (!clickedCopy && progress.hasCopyAction && !clickedActionAbove) {
        clickedActionAbove =
          await automationView.tryClickActionAboveButtonByLabels(
            CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS,
            CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS,
          );
        if (clickedActionAbove) {
          await automationView.clearBridgedShareResponseUrl();
          await automationView.clearShareNetworkEvents();
          diagnostics?.record('share-copy', 'clicked action above copy button');
        }
      }
    }

    if (clickedCopy) {
      capturePendingShareUrl(
        await automationView.getSharedUrlCandidate(),
        'modal DOM after copy click',
      );
    }

    if (clickedCopy && !copyConfirmed && progress.hasCopySuccess) {
      copyConfirmed = true;
      if (!copyConfirmedAt) {
        copyConfirmedAt = Date.now();
        diagnostics?.record('share-copy', 'copy success marker detected after click');
      }
    }

    if (copyConfirmed) {
      capturePendingShareUrl(
        await automationView.getSharedUrlCandidate(),
        'modal DOM after copy confirmation',
      );
      if (pendingShareUrl) {
        diagnostics?.record('share-copy', `copy confirmed with share url from ${pendingShareUrlSource}`);
        clipboard.writeText(pendingShareUrl);
        return { shareUrl: pendingShareUrl, status: 'copied' };
      }
      if (copyConfirmedAt && Date.now() - copyConfirmedAt >= 1_500) {
        diagnostics?.record('share-copy', 'copy confirmation settled but waiting for concrete share url');
      }
    }

    if (
      !copyConfirmed &&
      backendShareUpdateDetectedAt &&
      pendingShareUrl &&
      Date.now() - backendShareUpdateDetectedAt >= 1_500
    ) {
      diagnostics?.record(
        'share-copy',
        `backend share update settled with share url from ${pendingShareUrlSource}`,
      );
      clipboard.writeText(pendingShareUrl);
      return { shareUrl: pendingShareUrl, status: 'copied' };
    }

    if (clickedCopyAt && !copyConfirmed && Date.now() - clickedCopyAt >= 2_500) {
      capturePendingShareUrl(readSharedUrlFromClipboardOnce(), 'delayed system clipboard');
    }

    await sleep(intervalMs);
  }

  return { status: 'window_closed' };
};
