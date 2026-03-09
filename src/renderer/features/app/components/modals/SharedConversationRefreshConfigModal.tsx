import type { FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import type { SharedConversationRefreshConfigState } from '../../lib/appTypes';

type SharedConversationRefreshConfigModalProps = {
  onClose: () => void;
  onStateChange: (
    nextState:
      | SharedConversationRefreshConfigState
      | null
      | ((current: SharedConversationRefreshConfigState | null) => SharedConversationRefreshConfigState | null),
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  refreshConfigState: SharedConversationRefreshConfigState | null;
};

export function SharedConversationRefreshConfigModal({
  onClose,
  onStateChange,
  onSubmit,
  refreshConfigState,
}: SharedConversationRefreshConfigModalProps) {
  return (
    <Modal
      ariaLabelledBy="shared-chat-refresh-config-modal-title"
      eyebrow="대화 새로고침"
      isOpen={!!refreshConfigState}
      onClose={onClose}
      title="GPT 새로고침 설정"
    >
      <form className="modal__form" onSubmit={onSubmit}>
        <p className="modal__hint">
          <strong>{refreshConfigState?.conversationTitle ?? ''}</strong> 대화의 새로고침 방식을 설정합니다.
        </p>
        <label className="modal__label" htmlFor="refresh-mode">새로고침 방식</label>
        <select
          id="refresh-mode"
          className="modal__input"
          value={refreshConfigState?.mode ?? 'direct-share-page'}
          onChange={(event) =>
            onStateChange((current) =>
              current
                ? {
                    ...current,
                    mode:
                      event.target.value === 'chatgpt-share-flow'
                        ? 'chatgpt-share-flow'
                        : event.target.value === 'direct-chat-page'
                          ? 'direct-chat-page'
                        : 'direct-share-page',
                  }
                : current,
            )
          }
        >
          <option value="direct-share-page">공유 대화 URL 직접 새로고침</option>
          <option value="direct-chat-page">원본 링크 직접 새로고침</option>
          <option value="chatgpt-share-flow">GPT 웹앱 자동 새로고침</option>
        </select>
        <label className="modal__label" htmlFor="refresh-share-url">
          현재 링크
          <small className="modal__label-meta">읽기 전용</small>
        </label>
        <input
          id="refresh-share-url"
          className="modal__input"
          type="url"
          value={refreshConfigState?.shareUrl ?? ''}
          readOnly
        />
        <label className="modal__label" htmlFor="refresh-chat-url">
          원본 ChatGPT 대화 URL
          <small className="modal__label-meta">자동 새로고침용</small>
        </label>
        <input
          id="refresh-chat-url"
          className="modal__input"
          type="url"
          placeholder="https://chatgpt.com/c/..."
          value={refreshConfigState?.chatUrl ?? ''}
          onChange={(event) =>
            onStateChange((current) =>
              current
                ? {
                    ...current,
                    chatUrl: event.target.value,
                  }
                : current,
            )
          }
        />
        <label className="modal__label" htmlFor="refresh-project-url">
          원본 ChatGPT 프로젝트 URL
          <small className="modal__label-meta">프로젝트 대화인 경우만</small>
        </label>
        <input
          id="refresh-project-url"
          className="modal__input"
          type="url"
          placeholder="https://chatgpt.com/project/..."
          value={refreshConfigState?.projectUrl ?? ''}
          onChange={(event) =>
            onStateChange((current) =>
              current
                ? {
                    ...current,
                    projectUrl: event.target.value,
                  }
                : current,
            )
          }
        />
        <p className="modal__hint">
          자동 새로고침은 보조 ChatGPT 창을 열어 <code>Share</code> 모달과 <code>Update and Copy Link</code> 흐름을 시도합니다.
        </p>
        <p className="modal__hint">
          원본 링크 직접 새로고침은 공유 대화 URL 단계를 건너뛰고 현재 ChatGPT 대화 DOM을 바로 가져옵니다.
        </p>
        <p className="modal__hint">
          프로젝트 대화라면 먼저 프로젝트를 연 뒤 해당 대화의 더보기 메뉴에서 공유하기를 시도합니다.
        </p>
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button variant="primary" type="submit">저장</Button>
        </div>
      </form>
    </Modal>
  );
}
