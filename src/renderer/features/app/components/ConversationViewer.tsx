import { Button } from '../../../components/ui/Button';
import { MessageList } from '../../messages/components/MessageList';
import { ConversationInput } from './ConversationInput';
import { isRefreshableSharedConversation } from '../lib/appTypes';
import { isChatUrlImportedConversation } from '../lib/sharedConversationUtils';
import type { Conversation, SourcePreview, ThemeMode } from '../../../types/chat';

type ConversationViewerProps = {
  activeConversation: Conversation | null;
  initialMessageHeights?: Record<string, number>;
  initialScrollTop?: number;
  sendMessageStatus?: 'idle' | 'sending' | 'receiving';
  onClearConversation: (conversationId: string) => void;
  onMessageHeightChange: (conversationId: string, messageId: string, height: number) => void;
  onOpenRefreshSettings: (conversationId: string) => void;
  onRefreshConversation: () => void;
  onSendMessage: (message: string) => void;
  onRerenderConversation: () => void;
  onScrollPositionChange: (conversationId: string, scrollTop: number) => void;
  onSourcePreviewNeeded: Parameters<typeof MessageList>[0]['onSourcePreviewNeeded'];
  onToggleSourceDrawer: Parameters<typeof MessageList>[0]['onToggleSourceDrawer'];
  refreshError: string;
  refreshingConversationId: string | null;
  renderNonce: number;
  sourceDrawerMessageId?: string;
  sourcePreviewCache: Record<string, SourcePreview>;
  sourcePreviewLoading: Record<string, boolean>;
  themeMode: ThemeMode;
};

export function ConversationViewer({
  activeConversation,
  initialMessageHeights,
  initialScrollTop,
  sendMessageStatus,
  onClearConversation,
  onMessageHeightChange,
  onOpenRefreshSettings,
  onRefreshConversation,
  onSendMessage,
  onRerenderConversation,
  onScrollPositionChange,
  onSourcePreviewNeeded,
  onToggleSourceDrawer,
  refreshError,
  refreshingConversationId,
  renderNonce,
  sourceDrawerMessageId,
  sourcePreviewCache,
  sourcePreviewLoading,
  themeMode,
}: ConversationViewerProps) {
  return (
    <section className="viewer">
      <div className="viewer__body">
        <section className="viewer__panel viewer__panel--stream">
          {activeConversation ? (
            <>
                <div className="stream-intro">
                <div className="stream-intro__header">
                  <div className="stream-intro__title-group">
                    <div className="stream-intro__title-scroll" title={activeConversation.title}>
                      <h3>{activeConversation.title}</h3>
                    </div>
                    {isChatUrlImportedConversation(activeConversation) ? (
                      <span className="stream-intro__badge">원본 링크</span>
                    ) : null}
                  </div>
                  <div className="stream-intro__actions">
                    <Button
                      className="stream-intro__refresh"
                      variant="ghost"
                      onClick={() => onClearConversation(activeConversation.id)}
                      disabled={activeConversation.messages.length === 0}
                    >
                        내용 비우기
                    </Button>
                    <Button
                      className="stream-intro__refresh"
                      variant="ghost"
                      onClick={onRerenderConversation}
                      disabled={activeConversation.messages.length === 0}
                    >
                      재렌더링
                    </Button>
                    {isRefreshableSharedConversation(activeConversation) ? (
                      <>
                      <Button
                        className="stream-intro__refresh"
                        variant="ghost"
                        onClick={() => onOpenRefreshSettings(activeConversation.id)}
                      >
                        새로고침 설정
                      </Button>
                      <Button
                        className="stream-intro__refresh"
                        variant="secondary"
                        onClick={onRefreshConversation}
                        disabled={refreshingConversationId === activeConversation.id}
                      >
                        {refreshingConversationId === activeConversation.id ? '새로고침 중...' : '새로고침'}
                      </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {activeConversation.sourceUrl ? (
                  <div className="stream-intro__meta">
                    <span>{activeConversation.sourceUrl}</span>
                    <a href={activeConversation.sourceUrl} target="_blank" rel="noreferrer">브라우저에서 열기</a>
                  </div>
                ) : null}
                {activeConversation.importWarning ? (
                  <p className="stream-intro__warning" role="status">
                    {activeConversation.importWarning.message}
                  </p>
                ) : null}
                {refreshError ? <p className="stream-intro__error" role="alert">{refreshError}</p> : null}
              </div>

              {activeConversation.messages.length > 0 ? (
                <MessageList
                  key={`${activeConversation.id}:${activeConversation.fetchedAt ?? 'base'}:${renderNonce}`}
                  activeConversation={activeConversation}
                  initialMessageHeights={initialMessageHeights}
                  initialScrollTop={initialScrollTop}
                  onMessageHeightChange={onMessageHeightChange}
                  onScrollPositionChange={onScrollPositionChange}
                  onSourcePreviewNeeded={onSourcePreviewNeeded}
                  onToggleSourceDrawer={onToggleSourceDrawer}
                  sourceDrawerMessageId={sourceDrawerMessageId}
                  sourcePreviewCache={sourcePreviewCache}
                  sourcePreviewLoading={sourcePreviewLoading}
                  renderNonce={renderNonce}
                  themeMode={themeMode}
                />
              ) : (
                <div className="viewer-empty viewer-empty--conversation">
                  <h3>대화 내용이 비어 있습니다</h3>
                  <p>새로고침하기 전까지는 이 대화가 빈 상태로 유지됩니다.</p>
                </div>
              )}

              {(isChatUrlImportedConversation(activeConversation) || activeConversation.refreshRequest?.chatUrl) ? (
                <ConversationInput
                  onSendMessage={onSendMessage}
                  sendMessageStatus={sendMessageStatus}
                  isRefreshing={refreshingConversationId === activeConversation.id}
                  disabled={sendMessageStatus !== 'idle'} 
                />
              ) : null}
            </>
          ) : (
            <div className="viewer-empty">
              <h3>대화가 없습니다</h3>
              <p>왼쪽에서 새 폴더를 만들거나 대화를 불러오세요.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
