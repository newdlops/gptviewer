import { SharedConversationRefreshError } from '../SharedConversationRefreshError';
import {
  ChatGptAutomationView,
  type ChatGptAutomationVisibilityMode,
} from './ChatGptAutomationView';
import {
  CHATGPT_CHALLENGE_TEXT_MARKERS,
  CHATGPT_LOGIN_TEXT_MARKERS,
  CHATGPT_LOGIN_URL_PATTERNS,
} from './ChatGptDomSelectors';
import { includesMarker } from './chatGptRefreshHelpers';

type ChatGptPageSnapshot = Awaited<
  ReturnType<ChatGptAutomationView['getPageSnapshot']>
>;

const LOGIN_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000;
const LOGIN_COMPLETION_POLL_MS = 400;
const LOGIN_COMPLETION_STABLE_POLLS = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isLoginLikeSnapshot = (snapshot: ChatGptPageSnapshot) => {
  const isLoginUrl = CHATGPT_LOGIN_URL_PATTERNS.some((pattern) =>
    pattern.test(snapshot.currentUrl),
  );

  return (
    isLoginUrl ||
    includesMarker(snapshot.bodyText, CHATGPT_LOGIN_TEXT_MARKERS) ||
    includesMarker(snapshot.bodyText, CHATGPT_CHALLENGE_TEXT_MARKERS)
  );
};

export const ensureLoginAttentionIfNeeded = async (
  automationView: ChatGptAutomationView,
) => {
  const snapshot = await automationView.getPageSnapshot();
  if (!isLoginLikeSnapshot(snapshot)) {
    return null;
  }

  await automationView.presentForAttention();
  return snapshot;
};

export const buildLoginRequiredDetail = (snapshot: ChatGptPageSnapshot) =>
  snapshot.currentUrl || snapshot.title || 'ChatGPT 로그인 또는 보안 확인 화면';

export const waitForLoginCompletion = async (
  automationView: ChatGptAutomationView,
  timeoutMs = LOGIN_COMPLETION_TIMEOUT_MS,
  pollMs = LOGIN_COMPLETION_POLL_MS,
) => {
  const deadline = Date.now() + timeoutMs;
  let stableCompletedPolls = 0;

  while (Date.now() < deadline) {
    if (automationView.isClosed()) {
      return {
        detail: '보조 ChatGPT 창이 닫혀 로그인을 이어갈 수 없습니다.',
        status: 'window_closed' as const,
      };
    }

    const snapshot = await automationView.getPageSnapshot();
    if (!isLoginLikeSnapshot(snapshot)) {
      stableCompletedPolls += 1;
      if (stableCompletedPolls >= LOGIN_COMPLETION_STABLE_POLLS) {
        return {
          snapshot,
          status: 'completed' as const,
        };
      }
    } else {
      stableCompletedPolls = 0;
    }

    await sleep(pollMs);
  }

  return {
    detail: '로그인 완료를 기다리는 시간이 초과되었습니다. 보조 창에서 로그인을 마친 뒤 다시 시도해 주세요.',
    status: 'timeout' as const,
  };
};

export const runWithLoginResume = async <T>({
  initialMode,
  runAttempt,
}: {
  initialMode: ChatGptAutomationVisibilityMode;
  runAttempt: (
    automationView: ChatGptAutomationView,
    visibilityMode: ChatGptAutomationVisibilityMode,
  ) => Promise<T>;
}) => {
  let visibilityMode = initialMode;
  let resumedAfterLogin = false;
  let shouldRetry = true;

  while (shouldRetry) {
    const automationView = await ChatGptAutomationView.acquire(visibilityMode);
    let preserveWindowOnError = false;

    try {
      return await runAttempt(automationView, visibilityMode);
    } catch (error) {
      if (
        error instanceof SharedConversationRefreshError &&
        error.code === 'login_required' &&
        !resumedAfterLogin
      ) {
        preserveWindowOnError = true;
        const loginResolution = await waitForLoginCompletion(automationView);
        if (loginResolution.status === 'completed') {
          await automationView.close();
          resumedAfterLogin = true;
          visibilityMode = 'background';
          shouldRetry = true;
          continue;
        }

        throw error;
      }

      throw error;
    } finally {
      if (!preserveWindowOnError) {
        await automationView.close();
      }
    }
  }

  throw new Error('로그인 재개 루프가 예기치 않게 종료되었습니다.');
};
