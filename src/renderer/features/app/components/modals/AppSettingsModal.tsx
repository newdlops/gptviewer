import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';

type AppSettingsModalProps = {
  chatGptSessionError: string;
  chatGptSessionNotice: string;
  isOpen: boolean;
  isResettingChatGptSession: boolean;
  isResettingMermaidCache: boolean;
  mermaidCacheError: string;
  mermaidCacheNotice: string;
  onClose: () => void;
  onResetMermaidCache: () => void;
  onResetChatGptSessionState: () => void;
};

export function AppSettingsModal({
  chatGptSessionError,
  chatGptSessionNotice,
  isOpen,
  isResettingChatGptSession,
  isResettingMermaidCache,
  mermaidCacheError,
  mermaidCacheNotice,
  onClose,
  onResetMermaidCache,
  onResetChatGptSessionState,
}: AppSettingsModalProps) {
  return (
    <Modal
      ariaLabelledBy="app-settings-modal-title"
      eyebrow="앱 설정"
      isOpen={isOpen}
      onClose={onClose}
      title="설정"
    >
      <div className="modal__form">
        <section className="modal__section">
          <div className="modal__section-header">
            <strong>ChatGPT 자동화 세션 초기화</strong>
            <span>세션 · 쿠키 · 캐시 초기화</span>
          </div>
          <p className="modal__hint">
            프로젝트 불러오기, 대화 새로고침, 원본 링크 불러오기에서 사용하는
            ChatGPT 자동화 브라우저 세션을 초기화합니다.
          </p>
          <p className="modal__hint">
            현재 열려 있는 보조창을 정리하고, 자동화용 GPT 로그인 상태와 쿠키,
            스토리지, 캐시를 함께 비웁니다.
          </p>
          {chatGptSessionError ? (
            <p className="modal__error" role="alert">
              {chatGptSessionError}
            </p>
          ) : null}
          {chatGptSessionNotice ? (
            <p className="modal__hint modal__hint--success" role="status">
              {chatGptSessionNotice}
            </p>
          ) : null}
          <div className="modal__actions">
            <Button
              variant="danger"
              onClick={onResetChatGptSessionState}
              disabled={isResettingChatGptSession}
            >
              {isResettingChatGptSession ? '초기화 중...' : 'ChatGPT 세션 초기화'}
            </Button>
          </div>
        </section>
        <section className="modal__section">
          <div className="modal__section-header">
            <strong>Mermaid 캐시 초기화</strong>
            <span>렌더 캐시 · 사용자 수정 코드 초기화</span>
          </div>
          <p className="modal__hint">
            Mermaid 자동 변환 결과, 렌더 캐시, 사용자 직접 수정 코드 캐시를
            초기화합니다.
          </p>
          <p className="modal__hint">
            GPT 로그인 상태나 보조창 세션에는 영향을 주지 않고, 다이어그램 관련
            상태만 다시 계산하게 만듭니다.
          </p>
          {mermaidCacheError ? (
            <p className="modal__error" role="alert">
              {mermaidCacheError}
            </p>
          ) : null}
          {mermaidCacheNotice ? (
            <p className="modal__hint modal__hint--success" role="status">
              {mermaidCacheNotice}
            </p>
          ) : null}
          <div className="modal__actions">
            <Button
              variant="danger"
              onClick={onResetMermaidCache}
              disabled={isResettingMermaidCache}
            >
              {isResettingMermaidCache ? '초기화 중...' : 'Mermaid 캐시 초기화'}
            </Button>
          </div>
        </section>
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
