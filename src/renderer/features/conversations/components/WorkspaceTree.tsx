import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { WORKSPACE_ROOT_VALUE } from '../lib/workspaceTree';
import { isChatUrlImportedConversation } from '../../app/lib/sharedConversationUtils';
import type {
  Conversation,
  WorkspaceConversationNode,
  WorkspaceFolderNode,
  WorkspaceFolderSortMode,
  WorkspaceNode,
} from '../../../types/chat';

type SiblingPosition = 'after' | 'before';

type DropTargetState =
  | {
      folderId: string | null;
      kind: 'folder';
    }
  | {
      kind: 'sibling';
      position: SiblingPosition;
      targetNodeId: string;
    };

type WorkspaceTreeProps = {
  activeConversationId: string;
  canDropNode: (nodeId: string, destinationFolderId: string | null) => boolean;
  canReorderNode: (
    nodeId: string,
    targetNodeId: string,
    position: SiblingPosition,
  ) => boolean;
  conversations: Conversation[];
  expandedFolderState: Record<string, boolean>;
  isCollapsed: boolean;
  onConversationSelect: (conversationId: string) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onDeleteConversation: (conversationId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onFolderSortToggle: (folderId: string) => void;
  onNodeDrop: (nodeId: string, destinationFolderId: string | null) => void;
  onNodeReorder: (
    nodeId: string,
    targetNodeId: string,
    position: SiblingPosition,
  ) => void;
  onFolderToggle: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
  onProjectFolder: (folderId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onSyncProjectFolder: (folderId: string, projectUrl: string) => void;
  rootSortMode: WorkspaceFolderSortMode;
  tree: WorkspaceNode[];
  streamingStatuses?: Record<string, 'idle' | 'sending' | 'receiving'>;
};

type PointerDragPayload = {
  label: string;
  nodeId: string;
  type: 'conversation' | 'folder';
};

type PointerDragState = PointerDragPayload & {
  active: boolean;
  startX: number;
  startY: number;
};

type DragPreviewState = PointerDragPayload & {
  x: number;
  y: number;
};

type WorkspaceTreeNodeProps = {
  activeConversationId: string;
  conversationLookup: Map<string, Conversation>;
  draggedNodeId: string | null;
  dropTargetState: DropTargetState | undefined;
  expandedFolderState: Record<string, boolean>;
  isCollapsed: boolean;
  node: WorkspaceNode;
  onConversationSelect: (conversationId: string) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onDeleteConversation: (conversationId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onFolderSortToggle: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
  onProjectFolder: (folderId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onSyncProjectFolder: (folderId: string, projectUrl: string) => void;
  onNodePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    payload: PointerDragPayload,
  ) => void;
  suppressedClickNodeId: string | null;
  inheritedSortMode: WorkspaceFolderSortMode;
  depth: number;
  streamingStatuses?: Record<string, 'idle' | 'sending' | 'receiving'>;
};

const POINTER_DRAG_THRESHOLD = 6;
const FOLDER_INSIDE_DROP_THRESHOLD = 12;

const getTreeNodeStyle = (depth: number): CSSProperties =>
  ({
    '--tree-depth': depth,
  }) as CSSProperties;

function RenameActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M10.9 2.1a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-7.6 7.6-3 0.9 0.9-3 7.6-7.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M9.7 3.3l3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function CreateFolderActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M1.8 4.4c0-.7.5-1.2 1.2-1.2h3l1 1.3h6.2c.7 0 1.2.5 1.2 1.2v5.9c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2V4.4Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M8 6.5v3.6M6.2 8.3h3.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function MoveActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 2.2v11.6M8 2.2 5.9 4.3M8 2.2l2.1 2.1M13.8 8H2.2M13.8 8l-2.1-2.1M13.8 8l-2.1 2.1M8 13.8l-2.1-2.1M8 13.8l2.1-2.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function DeleteActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.4 4.1h9.2M6.1 2.6h3.8M5 4.1v8.1m3-8.1v8.1m3-8.1v8.1M4.6 4.1l.4 8.5c0 .5.4.8.8.8h4.4c.5 0 .8-.3.8-.8l.4-8.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function SyncActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M13.3 6.2a5.4 5.4 0 0 0-9.2-2.1M2.7 9.8a5.4 5.4 0 0 0 9.2 2.1M10.7 2.7h2.6v2.6M5.3 13.3H2.7v-2.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ProjectActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2.7 3.7h10.6v8.6H2.7zM5.3 2.3v2.1M10.7 2.3v2.1M5.2 7.9h5.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function SortActionIcon({
  sortMode,
}: {
  sortMode?: WorkspaceFolderSortMode;
}) {
  if (sortMode === 'asc') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M4 13V3m0 0-2 2m2-2 2 2M8.5 5.2h5M8.5 8h3.5M8.5 10.8h2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  if (sortMode === 'desc') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M4 3v10m0 0-2-2m2 2 2-2M8.5 5.2h2M8.5 8h3.5M8.5 10.8h5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.2 4.6h9.6M3.2 8h7.2M3.2 11.4h4.8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

const treeNodeTitleCollator = new Intl.Collator('ko', {
  numeric: true,
  sensitivity: 'base',
});

const getWorkspaceNodeDisplayTitle = (
  node: WorkspaceNode,
  conversationLookup: Map<string, Conversation>,
): string => {
  if (node.type === 'folder') {
    return node.name;
  }

  return conversationLookup.get(node.conversationId)?.title ?? '';
};

const getWorkspaceNodeTypePriority = (node: WorkspaceNode): number =>
  node.type === 'folder' ? 0 : 1;

const getWorkspaceNodeCreatedAt = (node: WorkspaceNode): number => {
  const timestamp = Date.parse(node.meta.createdAt);

  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getFolderSortToggleTooltip = (
  sortMode?: WorkspaceFolderSortMode,
): string => {
  if (sortMode === 'desc') {
    return '로컬 정렬: 이름 오름차순으로 변경';
  }

  if (sortMode === 'asc') {
    return '로컬 정렬: 상위/전역 정렬 상속으로 변경';
  }

  return '로컬 정렬: 이름 내림차순으로 설정';
};

const getSortedWorkspaceChildren = (
  nodes: WorkspaceNode[],
  conversationLookup: Map<string, Conversation>,
  sortMode: WorkspaceFolderSortMode,
): WorkspaceNode[] => {
  return [...nodes].sort((leftNode, rightNode) => {
    const typeComparison =
      getWorkspaceNodeTypePriority(leftNode) -
      getWorkspaceNodeTypePriority(rightNode);

    if (typeComparison !== 0) {
      return typeComparison;
    }

    if (sortMode === 'none') {
      const createdAtComparison =
        getWorkspaceNodeCreatedAt(rightNode) - getWorkspaceNodeCreatedAt(leftNode);

      if (createdAtComparison !== 0) {
        return createdAtComparison;
      }

      return treeNodeTitleCollator.compare(leftNode.id, rightNode.id);
    }

    const direction = sortMode === 'asc' ? 1 : -1;

    const titleComparison =
      treeNodeTitleCollator.compare(
        getWorkspaceNodeDisplayTitle(leftNode, conversationLookup),
        getWorkspaceNodeDisplayTitle(rightNode, conversationLookup),
      ) * direction;

    if (titleComparison !== 0) {
      return titleComparison;
    }

    return treeNodeTitleCollator.compare(leftNode.id, rightNode.id) * direction;
  });
};

const getDropTargetFromElement = (
  element: Element | null,
  clientY: number,
): DropTargetState | undefined => {
  const dropNodeElement = element?.closest('[data-drop-node-id]');

  if (dropNodeElement instanceof HTMLElement) {
    const targetNodeId = dropNodeElement.dataset.dropNodeId;
    const targetNodeType = dropNodeElement.dataset.dropNodeType;

    if (!targetNodeId || !targetNodeType) {
      return undefined;
    }

    const rect = dropNodeElement.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    const distanceToTop = offsetY;
    const distanceToBottom = rect.height - offsetY;

    if (
      targetNodeType === 'folder' &&
      distanceToTop > FOLDER_INSIDE_DROP_THRESHOLD &&
      distanceToBottom > FOLDER_INSIDE_DROP_THRESHOLD
    ) {
      return {
        folderId: targetNodeId,
        kind: 'folder',
      };
    }

    return {
      kind: 'sibling',
      position: offsetY < rect.height / 2 ? 'before' : 'after',
      targetNodeId,
    };
  }

  const dropFolderElement = element?.closest('[data-drop-folder-id]');

  if (!(dropFolderElement instanceof HTMLElement)) {
    return undefined;
  }

  const folderId = dropFolderElement.dataset.dropFolderId;

  if (!folderId) {
    return undefined;
  }

  return {
    folderId: folderId === WORKSPACE_ROOT_VALUE ? null : folderId,
    kind: 'folder',
  };
};

function WorkspaceConversationLeaf({
  activeConversationId,
  conversationLookup,
  depth,
  draggedNodeId,
  dropTargetState,
  isCollapsed,
  node,
  onConversationSelect,
  onDeleteConversation,
  onNodePointerDown,
  onRenameConversation,
  suppressedClickNodeId,
  streamingStatus,
}: {
  activeConversationId: string;
  conversationLookup: Map<string, Conversation>;
  depth: number;
  draggedNodeId: string | null;
  dropTargetState: DropTargetState | undefined;
  isCollapsed: boolean;
  node: WorkspaceConversationNode;
  onConversationSelect: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onNodePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    payload: PointerDragPayload,
  ) => void;
  onRenameConversation: (conversationId: string) => void;
  suppressedClickNodeId: string | null;
  streamingStatus?: 'idle' | 'sending' | 'receiving';
}) {
  const conversation = conversationLookup.get(node.conversationId);

  if (!conversation) {
    return null;
  }

  const isActive = activeConversationId === conversation.id;
  const isDragging = draggedNodeId === node.id;
  const isDropBefore =
    dropTargetState?.kind === 'sibling' &&
    dropTargetState.targetNodeId === node.id &&
    dropTargetState.position === 'before';
  const isDropAfter =
    dropTargetState?.kind === 'sibling' &&
    dropTargetState.targetNodeId === node.id &&
    dropTargetState.position === 'after';

  return (
    <div
      className={`workspace-tree__conversation-row${isDragging ? ' is-dragging' : ''}${isDropBefore ? ' is-drop-before' : ''}${isDropAfter ? ' is-drop-after' : ''}`}
      style={getTreeNodeStyle(depth)}
      data-drop-node-id={node.id}
      data-drop-node-type="conversation"
    >
      <button
        className={`workspace-tree__conversation${isActive ? ' is-active' : ''}${isDragging ? ' is-dragging' : ''}`}
        type="button"
        title={conversation.title}
        aria-label={conversation.title}
        onPointerDown={(event) =>
          onNodePointerDown(event, {
            label: conversation.title,
            nodeId: node.id,
            type: 'conversation',
          })
        }
        onClick={() => {
          if (suppressedClickNodeId === node.id) {
            return;
          }

          onConversationSelect(conversation.id);
        }}
      >
        <span className="workspace-tree__conversation-icon" aria-hidden="true" />
        {!isCollapsed ? (
          <span className="workspace-tree__conversation-title">
            <span className="workspace-tree__conversation-title-text">
              {conversation.title}
            </span>
            {isChatUrlImportedConversation(conversation) ? (
              <span className="workspace-tree__conversation-status">
                원본 링크
              </span>
            ) : null}
            {conversation.projectSyncStatus === 'viewer-created' ? (
              <span className="workspace-tree__conversation-status">
                뷰어에서 생성
              </span>
            ) : null}
            {streamingStatus === 'receiving' ? (
              <span className="workspace-tree__conversation-streaming-dot" title="메시지 수신 중" />
            ) : null}
          </span>
        ) : null}
      </button>
      {!isCollapsed ? (
        <div className="workspace-tree__conversation-actions">
          <button
            className="workspace-tree__folder-action"
            type="button"
            onClick={() => onRenameConversation(conversation.id)}
            aria-label={`${conversation.title} 대화 이름 변경`}
            data-tooltip="대화 이름 변경"
          >
            <span className="workspace-tree__folder-action-icon">
              <RenameActionIcon />
            </span>
          </button>
          <button
            className="workspace-tree__folder-action workspace-tree__folder-action--danger"
            type="button"
            onClick={() => onDeleteConversation(conversation.id)}
            aria-label={`${conversation.title} 대화 삭제`}
            data-tooltip="대화 삭제"
          >
            <span className="workspace-tree__folder-action-icon">
              <DeleteActionIcon />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceFolderBranch({
  activeConversationId,
  conversationLookup,
  depth,
  draggedNodeId,
  dropTargetState,
  expandedFolderState,
  inheritedSortMode,
  isCollapsed,
  node,
  onConversationSelect,
  onCreateFolder,
  onDeleteConversation,
  onDeleteFolder,
  onFolderSortToggle,
  onFolderToggle,
  onMoveFolder,
  onProjectFolder,
  onRenameConversation,
  onRenameFolder,
  onSyncProjectFolder,
  onNodePointerDown,
  suppressedClickNodeId,
  streamingStatuses,
}: {
  activeConversationId: string;
  conversationLookup: Map<string, Conversation>;
  depth: number;
  draggedNodeId: string | null;
  dropTargetState: DropTargetState | undefined;
  expandedFolderState: Record<string, boolean>;
  inheritedSortMode: WorkspaceFolderSortMode;
  isCollapsed: boolean;
  node: WorkspaceFolderNode;
  onConversationSelect: (conversationId: string) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onDeleteConversation: (conversationId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onFolderSortToggle: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
  onProjectFolder: (folderId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onSyncProjectFolder: (folderId: string, projectUrl: string) => void;
  onNodePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    payload: PointerDragPayload,
  ) => void;
  suppressedClickNodeId: string | null;
  streamingStatuses?: Record<string, 'idle' | 'sending' | 'receiving'>;
}) {
  const isExpanded = expandedFolderState[node.id] ?? false;
  const isDragging = draggedNodeId === node.id;
  const isDropInside =
    dropTargetState?.kind === 'folder' && dropTargetState.folderId === node.id;
  const isDropBefore =
    dropTargetState?.kind === 'sibling' &&
    dropTargetState.targetNodeId === node.id &&
    dropTargetState.position === 'before';
  const isDropAfter =
    dropTargetState?.kind === 'sibling' &&
    dropTargetState.targetNodeId === node.id &&
    dropTargetState.position === 'after';
  const isProjectFolder = node.source?.kind === 'project';
  const sortMode =
    node.sortMode === 'asc' || node.sortMode === 'desc'
      ? node.sortMode
      : undefined;
  const effectiveSortMode = sortMode ?? inheritedSortMode;
  const sortedChildren = getSortedWorkspaceChildren(
    node.children,
    conversationLookup,
    effectiveSortMode,
  );
  const handleFolderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onFolderToggle(node.id);
    }
  };

  return (
    <div className="workspace-tree__branch">
      <div
        className={`workspace-tree__folder-row${isProjectFolder ? ' is-project-folder' : ''}${isDropInside ? ' is-drop-target' : ''}${isDragging ? ' is-dragging' : ''}${isDropBefore ? ' is-drop-before' : ''}${isDropAfter ? ' is-drop-after' : ''}`}
        style={getTreeNodeStyle(depth)}
        data-drop-folder-id={node.id}
        data-drop-node-id={node.id}
        data-drop-node-type="folder"
      >
        <div
          className={`workspace-tree__folder${isExpanded ? ' is-expanded' : ''}${isProjectFolder ? ' is-project' : ''}${isDragging ? ' is-dragging' : ''}`}
          role="button"
          tabIndex={0}
          title={node.name}
          aria-label={node.name}
          aria-expanded={isExpanded}
          onPointerDown={(event) =>
            onNodePointerDown(event, {
              label: node.name,
              nodeId: node.id,
              type: 'folder',
            })
          }
          onClick={() => {
            if (suppressedClickNodeId === node.id) {
              return;
            }

            onFolderToggle(node.id);
          }}
          onKeyDown={handleFolderKeyDown}
        >
          {!isCollapsed ? (
            <span className="workspace-tree__folder-chevron" aria-hidden="true">
              {isExpanded ? '▾' : '▸'}
            </span>
          ) : null}
          <span
            className={`workspace-tree__folder-icon${isExpanded ? ' is-expanded' : ''}${isProjectFolder ? ' is-project' : ''}`}
            aria-hidden="true"
          />
          {!isCollapsed ? (
          <span className="workspace-tree__folder-label">
            <span className="workspace-tree__folder-label-text">{node.name}</span>
          </span>
        ) : null}
      </div>
        {!isCollapsed ? (
          <div className="workspace-tree__folder-actions">
            {node.source?.kind === 'project' ? (
              <button
                className="workspace-tree__folder-action workspace-tree__folder-action--sync"
                type="button"
                onClick={() =>
                  node.source?.kind === 'project'
                    ? onSyncProjectFolder(node.id, node.source.projectUrl)
                    : undefined
                }
                aria-label={`${node.name} 프로젝트 동기화`}
                data-tooltip="프로젝트 동기화"
              >
                <span className="workspace-tree__folder-action-icon">
                  <SyncActionIcon />
                </span>
              </button>
            ) : null}
            {!isProjectFolder ? (
              <button
                className="workspace-tree__folder-action"
                type="button"
                onClick={() => onProjectFolder(node.id)}
                aria-label={`${node.name} 프로젝트 폴더로 설정`}
                data-tooltip="프로젝트 폴더로 설정"
              >
                <span className="workspace-tree__folder-action-icon">
                  <ProjectActionIcon />
                </span>
              </button>
            ) : null}
            <button
              className={`workspace-tree__folder-action${sortMode ? ' workspace-tree__folder-action--active' : ''}`}
              type="button"
              onClick={() => onFolderSortToggle(node.id)}
              aria-label={`${node.name} ${getFolderSortToggleTooltip(sortMode)}`}
              data-tooltip={getFolderSortToggleTooltip(sortMode)}
            >
              <span className="workspace-tree__folder-action-icon">
                <SortActionIcon sortMode={sortMode} />
              </span>
            </button>
            <button
              className="workspace-tree__folder-action"
              type="button"
              onClick={() => onRenameFolder(node.id)}
              aria-label={`${node.name} 폴더 이름 변경`}
              data-tooltip="폴더 이름 변경"
            >
              <span className="workspace-tree__folder-action-icon">
                <RenameActionIcon />
              </span>
            </button>
            <button
              className="workspace-tree__folder-action"
              type="button"
              onClick={() => onCreateFolder(node.id)}
              aria-label={`${node.name} 아래에 폴더 만들기`}
              data-tooltip="하위 폴더 만들기"
            >
              <span className="workspace-tree__folder-action-icon">
                <CreateFolderActionIcon />
              </span>
            </button>
            <button
              className="workspace-tree__folder-action"
              type="button"
              onClick={() => onMoveFolder(node.id)}
              aria-label={`${node.name} 폴더 이동`}
              data-tooltip="폴더 이동"
            >
              <span className="workspace-tree__folder-action-icon">
                <MoveActionIcon />
              </span>
            </button>
            <button
              className="workspace-tree__folder-action workspace-tree__folder-action--danger"
              type="button"
              onClick={() => onDeleteFolder(node.id)}
              aria-label={`${node.name} 폴더 삭제`}
              data-tooltip="폴더 삭제"
            >
              <span className="workspace-tree__folder-action-icon">
                <DeleteActionIcon />
              </span>
            </button>
          </div>
        ) : null}
      </div>
      {isExpanded ? (
        <div className="workspace-tree__children">
          {sortedChildren.map((childNode) => (
            <WorkspaceTreeNode
              key={childNode.id}
              activeConversationId={activeConversationId}
              conversationLookup={conversationLookup}
              depth={depth + 1}
              draggedNodeId={draggedNodeId}
              dropTargetState={dropTargetState}
              expandedFolderState={expandedFolderState}
              isCollapsed={isCollapsed}
              node={childNode}
              onConversationSelect={onConversationSelect}
              onCreateFolder={onCreateFolder}
              onDeleteConversation={onDeleteConversation}
              onDeleteFolder={onDeleteFolder}
              onFolderSortToggle={onFolderSortToggle}
              onFolderToggle={onFolderToggle}
              onMoveFolder={onMoveFolder}
              onProjectFolder={onProjectFolder}
              onRenameConversation={onRenameConversation}
              onRenameFolder={onRenameFolder}
              onSyncProjectFolder={onSyncProjectFolder}
              onNodePointerDown={onNodePointerDown}
              suppressedClickNodeId={suppressedClickNodeId}
              inheritedSortMode={inheritedSortMode}
              streamingStatuses={streamingStatuses}
              />

          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceTreeNode({
  activeConversationId,
  conversationLookup,
  depth,
  draggedNodeId,
  dropTargetState,
  expandedFolderState,
  inheritedSortMode,
  isCollapsed,
  node,
  onConversationSelect,
  onCreateFolder,
  onDeleteConversation,
  onDeleteFolder,
  onFolderSortToggle,
  onFolderToggle,
  onMoveFolder,
  onProjectFolder,
  onRenameConversation,
  onRenameFolder,
  onSyncProjectFolder,
  onNodePointerDown,
  suppressedClickNodeId,
  streamingStatuses,
}: WorkspaceTreeNodeProps) {
  if (node.type === 'conversation') {
    return (
      <WorkspaceConversationLeaf
        activeConversationId={activeConversationId}
        conversationLookup={conversationLookup}
        depth={depth}
        draggedNodeId={draggedNodeId}
        dropTargetState={dropTargetState}
        isCollapsed={isCollapsed}
        node={node}
        onConversationSelect={onConversationSelect}
        onDeleteConversation={onDeleteConversation}
        onNodePointerDown={onNodePointerDown}
        onRenameConversation={onRenameConversation}
        suppressedClickNodeId={suppressedClickNodeId}
        streamingStatus={streamingStatuses?.[node.id]}
      />
    );
  }

  return (
    <WorkspaceFolderBranch
      activeConversationId={activeConversationId}
      conversationLookup={conversationLookup}
      depth={depth}
      draggedNodeId={draggedNodeId}
      dropTargetState={dropTargetState}
      expandedFolderState={expandedFolderState}
      inheritedSortMode={inheritedSortMode}
      isCollapsed={isCollapsed}
      node={node}
      onConversationSelect={onConversationSelect}
      onCreateFolder={onCreateFolder}
      onDeleteConversation={onDeleteConversation}
      onDeleteFolder={onDeleteFolder}
      onFolderSortToggle={onFolderSortToggle}
      onFolderToggle={onFolderToggle}
      onMoveFolder={onMoveFolder}
      onProjectFolder={onProjectFolder}
      onRenameConversation={onRenameConversation}
      onRenameFolder={onRenameFolder}
      onSyncProjectFolder={onSyncProjectFolder}
      onNodePointerDown={onNodePointerDown}
      suppressedClickNodeId={suppressedClickNodeId}
    />
  );
}

export function WorkspaceTree({
  activeConversationId,
  canDropNode,
  canReorderNode,
  conversations,
  expandedFolderState,
  isCollapsed,
  onConversationSelect,
  onCreateFolder,
  onDeleteConversation,
  onDeleteFolder,
  onFolderSortToggle,
  onNodeDrop,
  onNodeReorder,
  onFolderToggle,
  onMoveFolder,
  onProjectFolder,
  onRenameConversation,
  onRenameFolder,
  rootSortMode,
  onSyncProjectFolder,
  tree,
  streamingStatuses,
}: WorkspaceTreeProps) {
  const conversationLookup = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTargetState, setDropTargetState] = useState<
    DropTargetState | undefined
  >(undefined);
  const [pointerDragState, setPointerDragState] =
    useState<PointerDragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [suppressedClickNodeId, setSuppressedClickNodeId] = useState<
    string | null
  >(null);
  const dropTargetStateRef = useRef<DropTargetState | undefined>(undefined);
  const sortedRootNodes = getSortedWorkspaceChildren(
    tree,
    conversationLookup,
    rootSortMode,
  );

  useEffect(() => {
    dropTargetStateRef.current = dropTargetState;
  }, [dropTargetState]);

  useEffect(() => {
    if (!pointerDragState) {
      return;
    }

    const isDropTargetAllowed = (
      nodeId: string,
      targetState: DropTargetState | undefined,
    ): boolean => {
      if (!targetState) {
        return false;
      }

      if (targetState.kind === 'folder') {
        return canDropNode(nodeId, targetState.folderId);
      }

      return canReorderNode(nodeId, targetState.targetNodeId, targetState.position);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - pointerDragState.startX;
      const deltaY = event.clientY - pointerDragState.startY;
      const hasExceededThreshold =
        Math.hypot(deltaX, deltaY) >= POINTER_DRAG_THRESHOLD;

      if (!pointerDragState.active && !hasExceededThreshold) {
        return;
      }

      if (!pointerDragState.active) {
        setPointerDragState((currentState) =>
          currentState
            ? {
                ...currentState,
                active: true,
              }
            : currentState,
        );
        setDraggedNodeId(pointerDragState.nodeId);
      }

      const nextDropTargetState = getDropTargetFromElement(
        document.elementFromPoint(event.clientX, event.clientY),
        event.clientY,
      );
      const isValidDropTarget = isDropTargetAllowed(
        pointerDragState.nodeId,
        nextDropTargetState,
      );

      setDropTargetState(isValidDropTarget ? nextDropTargetState : undefined);
      setDragPreview({
        ...pointerDragState,
        x: event.clientX,
        y: event.clientY,
      });
    };

    const finalizePointerDrag = () => {
      const targetState = dropTargetStateRef.current;

      if (
        pointerDragState.active &&
        targetState &&
        isDropTargetAllowed(pointerDragState.nodeId, targetState)
      ) {
        if (targetState.kind === 'folder') {
          onNodeDrop(pointerDragState.nodeId, targetState.folderId);
        } else {
          onNodeReorder(
            pointerDragState.nodeId,
            targetState.targetNodeId,
            targetState.position,
          );
        }
      }

      if (pointerDragState.active) {
        setSuppressedClickNodeId(pointerDragState.nodeId);
        window.requestAnimationFrame(() => {
          setSuppressedClickNodeId((currentState) =>
            currentState === pointerDragState.nodeId ? null : currentState,
          );
        });
      }

      setPointerDragState(null);
      setDraggedNodeId(null);
      setDropTargetState(undefined);
      setDragPreview(null);
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = pointerDragState.active ? 'grabbing' : 'default';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finalizePointerDrag);
    window.addEventListener('pointercancel', finalizePointerDrag);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finalizePointerDrag);
      window.removeEventListener('pointercancel', finalizePointerDrag);
    };
  }, [canDropNode, canReorderNode, onNodeDrop, onNodeReorder, pointerDragState]);

  const handleNodePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    payload: PointerDragPayload,
  ) => {
    if (event.button !== 0) {
      return;
    }

    setPointerDragState({
      ...payload,
      active: false,
      startX: event.clientX,
      startY: event.clientY,
    });
    setDraggedNodeId(null);
    setDropTargetState(undefined);
    setDragPreview(null);
  };

  const isRootDropTarget =
    dropTargetState?.kind === 'folder' && dropTargetState.folderId === null;

  return (
    <nav
      className={`workspace-tree${isCollapsed ? ' is-collapsed' : ''}${draggedNodeId ? ' is-dragging-node' : ''}`}
      aria-label="작업 공간 트리"
    >
      <div
        className={`workspace-tree__root-dropzone${draggedNodeId ? ' is-visible' : ''}${isRootDropTarget ? ' is-drop-target' : ''}`}
        data-drop-folder-id={WORKSPACE_ROOT_VALUE}
      >
        {isCollapsed ? '루트' : '작업 공간 루트로 이동'}
      </div>
      {sortedRootNodes.map((node) => (
        <WorkspaceTreeNode
          key={node.id}
          activeConversationId={activeConversationId}
          conversationLookup={conversationLookup}
          depth={0}
          draggedNodeId={draggedNodeId}
          dropTargetState={dropTargetState}
          expandedFolderState={expandedFolderState}
          inheritedSortMode={rootSortMode}
          isCollapsed={isCollapsed}
          node={node}
          onConversationSelect={onConversationSelect}
          onCreateFolder={onCreateFolder}
          onDeleteConversation={onDeleteConversation}
          onDeleteFolder={onDeleteFolder}
          onFolderSortToggle={onFolderSortToggle}
          onFolderToggle={onFolderToggle}
          onMoveFolder={onMoveFolder}
          onProjectFolder={onProjectFolder}
          onRenameConversation={onRenameConversation}
          onRenameFolder={onRenameFolder}
          onSyncProjectFolder={onSyncProjectFolder}
          onNodePointerDown={handleNodePointerDown}
          suppressedClickNodeId={suppressedClickNodeId}
          streamingStatuses={streamingStatuses}
        />
      ))}
      {dragPreview ? (
        <div
          className="workspace-tree__drag-preview"
          style={{
            left: `${dragPreview.x + 14}px`,
            top: `${dragPreview.y + 14}px`,
          }}
        >
          <span className="workspace-tree__drag-preview-icon" aria-hidden="true">
            {dragPreview.type === 'folder' ? '폴더' : '대화'}
          </span>
          <span className="workspace-tree__drag-preview-label">
            {dragPreview.label}
          </span>
        </div>
      ) : null}
    </nav>
  );
}
