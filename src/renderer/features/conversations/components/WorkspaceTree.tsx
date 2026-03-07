import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { WORKSPACE_ROOT_VALUE } from '../lib/workspaceTree';
import type {
  Conversation,
  WorkspaceConversationNode,
  WorkspaceFolderNode,
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
  onDeleteFolder: (folderId: string) => void;
  onNodeDrop: (nodeId: string, destinationFolderId: string | null) => void;
  onNodeReorder: (
    nodeId: string,
    targetNodeId: string,
    position: SiblingPosition,
  ) => void;
  onFolderToggle: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  tree: WorkspaceNode[];
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
  onDeleteFolder: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onNodePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    payload: PointerDragPayload,
  ) => void;
  suppressedClickNodeId: string | null;
  depth: number;
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
  onNodePointerDown,
  onRenameConversation,
  suppressedClickNodeId,
}: {
  activeConversationId: string;
  conversationLookup: Map<string, Conversation>;
  depth: number;
  draggedNodeId: string | null;
  dropTargetState: DropTargetState | undefined;
  isCollapsed: boolean;
  node: WorkspaceConversationNode;
  onConversationSelect: (conversationId: string) => void;
  onNodePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    payload: PointerDragPayload,
  ) => void;
  onRenameConversation: (conversationId: string) => void;
  suppressedClickNodeId: string | null;
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
            {conversation.title}
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
            title="대화 이름 변경"
          >
            <span className="workspace-tree__folder-action-icon">
              <RenameActionIcon />
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
  isCollapsed,
  node,
  onConversationSelect,
  onCreateFolder,
  onDeleteFolder,
  onFolderToggle,
  onMoveFolder,
  onRenameConversation,
  onRenameFolder,
  onNodePointerDown,
  suppressedClickNodeId,
}: {
  activeConversationId: string;
  conversationLookup: Map<string, Conversation>;
  depth: number;
  draggedNodeId: string | null;
  dropTargetState: DropTargetState | undefined;
  expandedFolderState: Record<string, boolean>;
  isCollapsed: boolean;
  node: WorkspaceFolderNode;
  onConversationSelect: (conversationId: string) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onDeleteFolder: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onNodePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    payload: PointerDragPayload,
  ) => void;
  suppressedClickNodeId: string | null;
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
  const handleFolderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onFolderToggle(node.id);
    }
  };

  return (
    <div className="workspace-tree__branch">
      <div
        className={`workspace-tree__folder-row${isDropInside ? ' is-drop-target' : ''}${isDragging ? ' is-dragging' : ''}${isDropBefore ? ' is-drop-before' : ''}${isDropAfter ? ' is-drop-after' : ''}`}
        style={getTreeNodeStyle(depth)}
        data-drop-folder-id={node.id}
        data-drop-node-id={node.id}
        data-drop-node-type="folder"
      >
        <div
          className={`workspace-tree__folder${isExpanded ? ' is-expanded' : ''}${isDragging ? ' is-dragging' : ''}`}
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
            className={`workspace-tree__folder-icon${isExpanded ? ' is-expanded' : ''}`}
            aria-hidden="true"
          />
          {!isCollapsed ? (
            <span className="workspace-tree__folder-label">{node.name}</span>
          ) : null}
        </div>
        {!isCollapsed ? (
          <div className="workspace-tree__folder-actions">
            <button
              className="workspace-tree__folder-action"
              type="button"
              onClick={() => onRenameFolder(node.id)}
              aria-label={`${node.name} 폴더 이름 변경`}
              title="폴더 이름 변경"
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
              title="하위 폴더 만들기"
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
              title="폴더 이동"
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
              title="폴더 삭제"
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
          {node.children.map((childNode) => (
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
              onDeleteFolder={onDeleteFolder}
              onFolderToggle={onFolderToggle}
              onMoveFolder={onMoveFolder}
              onRenameConversation={onRenameConversation}
              onRenameFolder={onRenameFolder}
              onNodePointerDown={onNodePointerDown}
              suppressedClickNodeId={suppressedClickNodeId}
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
  isCollapsed,
  node,
  onConversationSelect,
  onCreateFolder,
  onDeleteFolder,
  onFolderToggle,
  onMoveFolder,
  onRenameConversation,
  onRenameFolder,
  onNodePointerDown,
  suppressedClickNodeId,
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
        onNodePointerDown={onNodePointerDown}
        onRenameConversation={onRenameConversation}
        suppressedClickNodeId={suppressedClickNodeId}
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
      isCollapsed={isCollapsed}
      node={node}
      onConversationSelect={onConversationSelect}
      onCreateFolder={onCreateFolder}
      onDeleteFolder={onDeleteFolder}
      onFolderToggle={onFolderToggle}
      onMoveFolder={onMoveFolder}
      onRenameConversation={onRenameConversation}
      onRenameFolder={onRenameFolder}
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
  onDeleteFolder,
  onNodeDrop,
  onNodeReorder,
  onFolderToggle,
  onMoveFolder,
  onRenameConversation,
  onRenameFolder,
  tree,
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
      {tree.map((node) => (
        <WorkspaceTreeNode
          key={node.id}
          activeConversationId={activeConversationId}
          conversationLookup={conversationLookup}
          depth={0}
          draggedNodeId={draggedNodeId}
          dropTargetState={dropTargetState}
          expandedFolderState={expandedFolderState}
          isCollapsed={isCollapsed}
          node={node}
          onConversationSelect={onConversationSelect}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteFolder}
          onFolderToggle={onFolderToggle}
          onMoveFolder={onMoveFolder}
          onRenameConversation={onRenameConversation}
          onRenameFolder={onRenameFolder}
          onNodePointerDown={handleNodePointerDown}
          suppressedClickNodeId={suppressedClickNodeId}
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
