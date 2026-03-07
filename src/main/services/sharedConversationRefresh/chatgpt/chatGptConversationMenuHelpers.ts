import {
  CHATGPT_MORE_BUTTON_LABELS,
  CHATGPT_MORE_BUTTON_TEST_IDS,
} from './ChatGptDomSelectors';
import { ChatGptAutomationView } from './ChatGptAutomationView';
import { buildWaitForConversationRowMenuAfterHoverScript } from './chatGptConversationListScripts';
import {
  buildGetConversationRowMenuButtonPointScript,
  type ConversationRowMenuButtonPointResult,
} from './chatGptConversationRowButtonScripts';
import { waitForShareActionMenuOpen } from './chatGptRefreshHelpers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clickAt = async (automationView: ChatGptAutomationView, x: number, y: number) => {
  await automationView.moveMouse(x, y);
  automationView.webContents.sendInputEvent({
    button: 'left',
    clickCount: 1,
    type: 'mouseDown',
    x,
    y,
  });
  automationView.webContents.sendInputEvent({
    button: 'left',
    clickCount: 1,
    type: 'mouseUp',
    x,
    y,
  });
};

export const waitForFloatingMenuFromConversationRow = async (
  automationView: ChatGptAutomationView,
  chatUrl: string,
  listHoverSelectors: string[] = [],
  hoverPoint?: { x: number; y: number },
  timeoutMs = 4_000,
  intervalMs = 100,
) => {
  const deadline = Date.now() + timeoutMs;
  if (hoverPoint) {
    await automationView.moveMouse(hoverPoint.x, hoverPoint.y);
  }
  while (Date.now() < deadline && !automationView.isClosed()) {
    const shareMenuState = await waitForShareActionMenuOpen(automationView, 220, 40);
    if (shareMenuState === 'opened' || shareMenuState === 'window_closed') {
      return shareMenuState;
    }

    const buttonPoint = await automationView.execute<ConversationRowMenuButtonPointResult>(
      buildGetConversationRowMenuButtonPointScript(
        chatUrl,
        CHATGPT_MORE_BUTTON_LABELS,
        CHATGPT_MORE_BUTTON_TEST_IDS,
        listHoverSelectors,
      ),
    );
    if (buttonPoint.status === 'ready') {
      await clickAt(automationView, buttonPoint.x, buttonPoint.y);
      await sleep(intervalMs);
      continue;
    }

    if (hoverPoint) {
      const clickedAfterHover = await automationView.execute<{ status: 'clicked' | 'not_found' | 'pending' }>(
        buildWaitForConversationRowMenuAfterHoverScript(
          chatUrl,
          CHATGPT_MORE_BUTTON_LABELS,
          CHATGPT_MORE_BUTTON_TEST_IDS,
          listHoverSelectors,
          800,
        ),
      );
      if (clickedAfterHover.status === 'clicked') {
        await sleep(intervalMs);
        continue;
      }
      await automationView.moveMouse(hoverPoint.x, hoverPoint.y);
      await sleep(intervalMs);
      continue;
    }

    const rowMenuStep = await automationView.stepConversationRowMenuByChatUrl(
      chatUrl,
      CHATGPT_MORE_BUTTON_LABELS,
      CHATGPT_MORE_BUTTON_TEST_IDS,
      listHoverSelectors,
    );

    if (rowMenuStep.status === 'clicked') {
      await sleep(intervalMs);
      continue;
    }

    if (rowMenuStep.status === 'hovered') {
      await automationView.moveMouse(rowMenuStep.x, rowMenuStep.y);
      const clickedAfterHover = await automationView.execute<{ status: 'clicked' | 'not_found' | 'pending' }>(
        buildWaitForConversationRowMenuAfterHoverScript(
          chatUrl,
          CHATGPT_MORE_BUTTON_LABELS,
          CHATGPT_MORE_BUTTON_TEST_IDS,
          listHoverSelectors,
          1_500,
        ),
      );
      if (clickedAfterHover.status !== 'clicked') {
        await automationView.moveMouse(rowMenuStep.x, rowMenuStep.y);
      }
      await sleep(intervalMs);
      continue;
    }

    if (rowMenuStep.status === 'scrolled') {
      return 'scrolled';
    }

    await sleep(intervalMs);
  }

  return automationView.isClosed() ? 'window_closed' : 'timeout';
};
