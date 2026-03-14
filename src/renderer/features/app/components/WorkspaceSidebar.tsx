import type { ComponentProps } from 'react';
import { Button } from '../../../components/ui/Button';
import { WorkspaceTree } from '../../conversations/components/WorkspaceTree';
import type {
  Conversation,
  ThemeMode,
  WorkspaceFolderSortMode,
  WorkspaceNode,
} from '../../../types/chat';
import { GoogleDriveSyncPanel } from './GoogleDriveSyncPanel';

type WorkspaceSidebarProps = {
  activeConversationId: string;
  conversations: Conversation[];
  expandedFolderState: Record<string, boolean>;
  googleDrivePanelProps: ComponentProps<typeof GoogleDriveSyncPanel>;
  isCollapsed: boolean;
  onOpenAppSettings: () => void;
  onConversationSelect: (conversationId: string) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onDeleteConversation: (conversationId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onGlobalFolderSortChange: (nextSortMode: WorkspaceFolderSortMode) => void;
  onFolderSortToggle: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onImportOpen: () => void;
  onProjectImportOpen: () => void;
  onMoveFolder: (folderId: string) => void;
  onNodeDrop: (nodeId: string, destinationFolderId: string | null) => void;
  onNodeReorder: (nodeId: string, targetNodeId: string, position: 'after' | 'before') => void;
  onProjectFolder: (folderId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onSyncProjectFolder: (folderId: string, projectUrl: string) => void;
  onThemeToggle: () => void;
  globalFolderSortMode: WorkspaceFolderSortMode | null;
  themeMode: ThemeMode;
  tree: WorkspaceNode[];
  canDropNode: (nodeId: string, destinationFolderId: string | null) => boolean;
  canReorderNode: (nodeId: string, targetNodeId: string, position: 'after' | 'before') => boolean;
  streamingStatuses?: Record<string, 'idle' | 'sending' | 'receiving'>;
};

export function WorkspaceSidebar({
  activeConversationId,
  canDropNode,
  canReorderNode,
  conversations,
  expandedFolderState,
  googleDrivePanelProps,
  isCollapsed,
  onOpenAppSettings,
  onConversationSelect,
  onCreateFolder,
  onDeleteConversation,
  onDeleteFolder,
  onGlobalFolderSortChange,
  onFolderSortToggle,
  onFolderToggle,
  onImportOpen,
  onProjectImportOpen,
  onMoveFolder,
  onNodeDrop,
  onNodeReorder,
  onProjectFolder,
  onRenameConversation,
  onRenameFolder,
  onSyncProjectFolder,
  onThemeToggle,
  globalFolderSortMode,
  themeMode,
  tree,
  streamingStatuses,
}: WorkspaceSidebarProps) {
  const normalizedGlobalFolderSortMode: WorkspaceFolderSortMode =
    globalFolderSortMode ?? 'none';
  const nextGlobalSortMode: WorkspaceFolderSortMode =
    normalizedGlobalFolderSortMode === 'desc'
      ? 'asc'
      : normalizedGlobalFolderSortMode === 'asc'
        ? 'none'
        : 'desc';
  const globalSortLabel =
    normalizedGlobalFolderSortMode === 'desc'
      ? '이름↓'
      : normalizedGlobalFolderSortMode === 'asc'
        ? '이름↑'
        : '지정없음';
  const globalSortTitle =
    normalizedGlobalFolderSortMode === 'desc'
      ? '이름 내림차순 적용됨: 클릭 시 오름차순으로 변경'
      : normalizedGlobalFolderSortMode === 'asc'
        ? '이름 오름차순 적용됨: 클릭 시 지정없음으로 변경'
        : '전역 정렬 지정없음: 클릭 시 이름 내림차순으로 변경';

  return (
    <aside className="drawer">
      <div className="drawer__top">
        <div className="drawer__heading">
          <button
            type="button"
            className="drawer__brand-button"
            onClick={onOpenAppSettings}
            aria-label="앱 설정 열기"
            title="앱 설정"
          >
            <p className="drawer__eyebrow">gptviewer</p>
            <h1>작업 공간</h1>
          </button>
          <div className="drawer__actions">
            <Button
              className="drawer__action-button"
              variant="ghost"
              onClick={onImportOpen}
              aria-label="대화 불러오기"
              title="대화 불러오기"
            >
              <span className="drawer-button__icon" aria-hidden="true">↗</span>
              <span className="drawer-button__label">대화</span>
            </Button>
            <Button
              className="drawer__action-button"
              variant="ghost"
              onClick={onProjectImportOpen}
              aria-label="프로젝트 불러오기"
              title="프로젝트 불러오기"
            >
              <span className="drawer-button__icon" aria-hidden="true">▦</span>
              <span className="drawer-button__label">프로젝트</span>
            </Button>
            <Button
              className="drawer__action-button"
              variant="secondary"
              onClick={() => onCreateFolder(null)}
              aria-label="새 폴더 만들기"
              title="새 폴더 만들기"
            >
              <span className="drawer-button__icon" aria-hidden="true">+</span>
              <span className="drawer-button__label">새폴더</span>
            </Button>
          </div>
          <div className="drawer__sort-panel">
            <div className="drawer__sort-header">
              <p className="drawer__eyebrow">정렬</p>
              <strong>트리 기본 정렬</strong>
            </div>
            <div className="drawer__sort-actions">
              <Button
                className={`drawer__sort-button${
                  normalizedGlobalFolderSortMode !== 'none' ? ' is-active' : ''
                }`}
                variant="secondary"
                onClick={() => onGlobalFolderSortChange(nextGlobalSortMode)}
                aria-label={`전역 이름 정렬: 현재 ${globalSortLabel}`}
                title={globalSortTitle}
              >
                이름 정렬: {globalSortLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <WorkspaceTree
        activeConversationId={activeConversationId}
        canDropNode={canDropNode}
        canReorderNode={canReorderNode}
        conversations={conversations}
        expandedFolderState={expandedFolderState}
        isCollapsed={isCollapsed}
        onConversationSelect={onConversationSelect}
        onCreateFolder={onCreateFolder}
        onDeleteConversation={onDeleteConversation}
        onDeleteFolder={onDeleteFolder}
        onFolderSortToggle={onFolderSortToggle}
        onNodeDrop={onNodeDrop}
        onNodeReorder={onNodeReorder}
        onFolderToggle={onFolderToggle}
        onMoveFolder={onMoveFolder}
        onRenameConversation={onRenameConversation}
        onRenameFolder={onRenameFolder}
        rootSortMode={globalFolderSortMode ?? 'none'}
        onProjectFolder={onProjectFolder}
        onSyncProjectFolder={onSyncProjectFolder}
        tree={tree}
        streamingStatuses={streamingStatuses}
      />

      <div className="drawer__footer">
        <Button
          variant="secondary"
          onClick={onThemeToggle}
          aria-label={themeMode === 'dark' ? '라이트 모드' : '다크 모드'}
          title={themeMode === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          <span className="drawer-button__icon" aria-hidden="true">{themeMode === 'dark' ? '☀' : '☾'}</span>
          <span className="drawer-button__label">{themeMode === 'dark' ? '라이트 모드' : '다크 모드'}</span>
        </Button>
        <GoogleDriveSyncPanel {...googleDrivePanelProps} />
      </div>
    </aside>
  );
}
