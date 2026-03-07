import type { ComponentProps } from 'react';
import { Button } from '../../../components/ui/Button';
import { WorkspaceTree } from '../../conversations/components/WorkspaceTree';
import type { Conversation, ThemeMode, WorkspaceNode } from '../../../types/chat';
import { GoogleDriveSyncPanel } from './GoogleDriveSyncPanel';

type WorkspaceSidebarProps = {
  activeConversationId: string;
  conversations: Conversation[];
  expandedFolderState: Record<string, boolean>;
  googleDrivePanelProps: ComponentProps<typeof GoogleDriveSyncPanel>;
  isCollapsed: boolean;
  onConversationSelect: (conversationId: string) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onDeleteFolder: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onImportOpen: () => void;
  onProjectImportOpen: () => void;
  onMoveFolder: (folderId: string) => void;
  onNodeDrop: (nodeId: string, destinationFolderId: string | null) => void;
  onNodeReorder: (nodeId: string, targetNodeId: string, position: 'after' | 'before') => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onThemeToggle: () => void;
  themeMode: ThemeMode;
  tree: WorkspaceNode[];
  canDropNode: (nodeId: string, destinationFolderId: string | null) => boolean;
  canReorderNode: (nodeId: string, targetNodeId: string, position: 'after' | 'before') => boolean;
};

export function WorkspaceSidebar({
  activeConversationId,
  canDropNode,
  canReorderNode,
  conversations,
  expandedFolderState,
  googleDrivePanelProps,
  isCollapsed,
  onConversationSelect,
  onCreateFolder,
  onDeleteFolder,
  onFolderToggle,
  onImportOpen,
  onProjectImportOpen,
  onMoveFolder,
  onNodeDrop,
  onNodeReorder,
  onRenameConversation,
  onRenameFolder,
  onThemeToggle,
  themeMode,
  tree,
}: WorkspaceSidebarProps) {
  return (
    <aside className="drawer">
      <div className="drawer__top">
        <div className="drawer__heading">
          <p className="drawer__eyebrow">gptviewer</p>
          <h1>작업 공간</h1>
          <div className="drawer__actions">
            <Button variant="ghost" onClick={onImportOpen} aria-label="공유 대화 불러오기" title="공유 대화 불러오기">
              <span className="drawer-button__icon" aria-hidden="true">↗</span>
              <span className="drawer-button__label">공유 대화</span>
            </Button>
            <Button variant="ghost" onClick={onProjectImportOpen} aria-label="프로젝트 불러오기" title="프로젝트 불러오기">
              <span className="drawer-button__icon" aria-hidden="true">▦</span>
              <span className="drawer-button__label">프로젝트</span>
            </Button>
            <Button variant="secondary" onClick={() => onCreateFolder(null)} aria-label="새 폴더 만들기" title="새 폴더 만들기">
              <span className="drawer-button__icon" aria-hidden="true">+</span>
              <span className="drawer-button__label">새 폴더</span>
            </Button>
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
        onDeleteFolder={onDeleteFolder}
        onNodeDrop={onNodeDrop}
        onNodeReorder={onNodeReorder}
        onFolderToggle={onFolderToggle}
        onMoveFolder={onMoveFolder}
        onRenameConversation={onRenameConversation}
        onRenameFolder={onRenameFolder}
        tree={tree}
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
