import { Button } from '../../../components/ui/Button';
import { MessageList } from '../../messages/components/MessageList';
import { isRefreshableSharedConversation } from '../lib/appTypes';
import type { Conversation, SourcePreview, ThemeMode } from '../../../types/chat';

type ConversationViewerProps = {
  activeConversation: Conversation | null;
  initialMessageHeights?: Record<string, number>;
  initialScrollTop?: number;
  onMessageHeightChange: (conversationId: string, messageId: string, height: number) => void;
  onOpenRefreshSettings: (conversationId: string) => void;
  onRefreshConversation: () => void;
  onScrollPositionChange: (conversationId: string, scrollTop: number) => void;
  onSourcePreviewNeeded: Parameters<typeof MessageList>[0]['onSourcePreviewNeeded'];
  onToggleSourceDrawer: Parameters<typeof MessageList>[0]['onToggleSourceDrawer'];
  refreshError: string;
  refreshingConversationId: string | null;
  sourceDrawerMessageId?: string;
  sourcePreviewCache: Record<string, SourcePreview>;
  sourcePreviewLoading: Record<string, boolean>;
  themeMode: ThemeMode;
};

export function ConversationViewer({
  activeConversation,
  initialMessageHeights,
  initialScrollTop,
  onMessageHeightChange,
  onOpenRefreshSettings,
  onRefreshConversation,
  onScrollPositionChange,
  onSourcePreviewNeeded,
  onToggleSourceDrawer,
  refreshError,
  refreshingConversationId,
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
                  <h3>{activeConversation.title}</h3>
                  {isRefreshableSharedConversation(activeConversation) ? (
                    <div className="stream-intro__actions">
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
                    </div>
                  ) : null}
                </div>
                {activeConversation.sourceUrl ? (
                  <div className="stream-intro__meta">
                    <span>{activeConversation.sourceUrl}</span>
                    <a href={activeConversation.sourceUrl} target="_blank" rel="noreferrer">원본 열기</a>
                  </div>
                ) : null}
                {refreshError ? <p className="stream-intro__error" role="alert">{refreshError}</p> : null}
              </div>

              <MessageList
                key={`${activeConversation.id}:${activeConversation.fetchedAt ?? 'base'}`}
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
                themeMode={themeMode}
              />
            </>
          ) : (
            <div className="viewer-empty">
              <h3>대화가 없습니다</h3>
              <p>왼쪽에서 새 폴더를 만들거나 공유 대화를 불러오세요.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
