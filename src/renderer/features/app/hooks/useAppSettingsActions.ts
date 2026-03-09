import { useCallback, useState } from 'react';
import { clearAllCustomMermaidSourceCache } from '../../messages/lib/customMermaidSourceCache';
import { clearAllCustomJavaSourceCache } from '../../messages/lib/customJavaSourceCache';
import { clearAllCodeBlockState } from '../../messages/lib/markdownCodeBlockState';

function buildResetSuccessMessage() {
  const resetTime = new Date();
  const formattedTime = resetTime.toLocaleString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
  return `ChatGPT 세션 저장소를 초기화했습니다. (${formattedTime})`;
}

function buildMermaidResetSuccessMessage() {
  const resetTime = new Date();
  const formattedTime = resetTime.toLocaleString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
  return `코드 블록(Mermaid/Java) 렌더 및 수정 캐시를 초기화했습니다. (${formattedTime})`;
}

function buildChatGptResetErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'ChatGPT 세션 초기화에 실패했습니다.';
  }

  if (
    error.message.includes(
      "No handler registered for 'chatgpt-automation:reset-session-state'",
    )
  ) {
    return '현재 실행 중인 앱 메인 프로세스가 구버전입니다. 앱을 완전히 종료한 뒤 다시 실행해 주세요.';
  }

  return error.message;
}

export function useAppSettingsActions() {
  const [chatGptSessionError, setChatGptSessionError] = useState('');
  const [chatGptSessionNotice, setChatGptSessionNotice] = useState('');
  const [mermaidCacheError, setMermaidCacheError] = useState('');
  const [mermaidCacheNotice, setMermaidCacheNotice] = useState('');
  const [isAppSettingsModalOpen, setIsAppSettingsModalOpen] = useState(false);
  const [isResettingChatGptSession, setIsResettingChatGptSession] = useState(false);
  const [isResettingMermaidCache, setIsResettingMermaidCache] = useState(false);

  const openAppSettingsModal = useCallback(() => {
    setChatGptSessionError('');
    setChatGptSessionNotice('');
    setMermaidCacheError('');
    setMermaidCacheNotice('');
    setIsAppSettingsModalOpen(true);
  }, []);

  const closeAppSettingsModal = useCallback(() => {
    setIsAppSettingsModalOpen(false);
  }, []);

  const handleResetChatGptSessionState = useCallback(async () => {
    if (!window.electronAPI || isResettingChatGptSession) {
      return;
    }

    setIsResettingChatGptSession(true);
    setChatGptSessionError('');
    setChatGptSessionNotice('');

    try {
      await window.electronAPI.resetChatGptAutomationSessionState();
      setChatGptSessionNotice(buildResetSuccessMessage());
    } catch (error) {
      setChatGptSessionError(buildChatGptResetErrorMessage(error));
    } finally {
      setIsResettingChatGptSession(false);
    }
  }, [isResettingChatGptSession]);

  const handleResetMermaidCache = useCallback(() => {
    if (isResettingMermaidCache) {
      return;
    }

    setIsResettingMermaidCache(true);
    setMermaidCacheError('');
    setMermaidCacheNotice('');

    try {
      clearAllCodeBlockState();
      clearAllCustomMermaidSourceCache();
      clearAllCustomJavaSourceCache();
      setMermaidCacheNotice(buildMermaidResetSuccessMessage());
    } catch (error) {
      setMermaidCacheError(
        error instanceof Error
          ? error.message
          : 'Mermaid 캐시 초기화에 실패했습니다.',
      );
    } finally {
      setIsResettingMermaidCache(false);
    }
  }, [isResettingMermaidCache]);

  return {
    chatGptSessionError,
    chatGptSessionNotice,
    closeAppSettingsModal,
    handleResetChatGptSessionState,
    handleResetMermaidCache,
    isAppSettingsModalOpen,
    isResettingChatGptSession,
    isResettingMermaidCache,
    mermaidCacheError,
    mermaidCacheNotice,
    openAppSettingsModal,
  };
}
