import type { WorkspaceFolderNode, WorkspaceNode } from '../../../types/chat';

export const SHARED_CONVERSATIONS_FOLDER_ID = 'workspace-root-imports';
export const WORKSPACE_ROOT_VALUE = '__workspace-root__';

export const collectFolderIds = (nodes: WorkspaceNode[]): string[] =>
  nodes.flatMap((node) =>
    node.type === 'folder'
      ? [node.id, ...collectFolderIds(node.children)]
      : [],
  );

export const buildExpandedFolderState = (
  nodes: WorkspaceNode[],
): Record<string, boolean> =>
  collectFolderIds(nodes).reduce<Record<string, boolean>>((state, folderId) => {
    state[folderId] = true;
    return state;
  }, {});

export const insertConversationIntoFolder = (
  nodes: WorkspaceNode[],
  folderId: string,
  conversationId: string,
): WorkspaceNode[] =>
  nodes.map((node) => {
    if (node.type !== 'folder') {
      return node;
    }

    if (node.id === folderId) {
      return {
        ...node,
        children: [
          {
            id: `workspace-conversation-${conversationId}`,
            type: 'conversation',
            conversationId,
          },
          ...node.children,
        ],
      };
    }

    return {
      ...node,
      children: insertConversationIntoFolder(node.children, folderId, conversationId),
    };
  });

export const findFirstConversationId = (
  nodes: WorkspaceNode[],
): string | undefined => {
  for (const node of nodes) {
    if (node.type === 'conversation') {
      return node.conversationId;
    }

    const nestedConversationId = findFirstConversationId(node.children);
    if (nestedConversationId) {
      return nestedConversationId;
    }
  }

  return undefined;
};

export const isWorkspaceFolderNode = (
  node: WorkspaceNode,
): node is WorkspaceFolderNode => node.type === 'folder';

const createFolderId = (): string =>
  `workspace-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const insertNodeIntoFolder = (
  nodes: WorkspaceNode[],
  folderId: string | null,
  nodeToInsert: WorkspaceNode,
): WorkspaceNode[] => {
  if (!folderId) {
    return [nodeToInsert, ...nodes];
  }

  return nodes.map((node) => {
    if (node.type !== 'folder') {
      return node;
    }

    if (node.id === folderId) {
      return {
        ...node,
        children: [nodeToInsert, ...node.children],
      };
    }

    return {
      ...node,
      children: insertNodeIntoFolder(node.children, folderId, nodeToInsert),
    };
  });
};

export const addFolderToTree = (
  nodes: WorkspaceNode[],
  folderName: string,
  parentFolderId: string | null,
): {
  folderId: string;
  tree: WorkspaceNode[];
} => {
  const folderId = createFolderId();
  const folderNode: WorkspaceFolderNode = {
    id: folderId,
    name: folderName,
    type: 'folder',
    children: [],
  };

  return {
    folderId,
    tree: insertNodeIntoFolder(nodes, parentFolderId, folderNode),
  };
};

export const renameFolderInTree = (
  nodes: WorkspaceNode[],
  folderId: string,
  nextName: string,
): WorkspaceNode[] =>
  nodes.map((node) => {
    if (node.type !== 'folder') {
      return node;
    }

    if (node.id === folderId) {
      return {
        ...node,
        name: nextName,
      };
    }

    return {
      ...node,
      children: renameFolderInTree(node.children, folderId, nextName),
    };
  });

export const findFolderById = (
  nodes: WorkspaceNode[],
  folderId: string,
): WorkspaceFolderNode | null => {
  for (const node of nodes) {
    if (node.type !== 'folder') {
      continue;
    }

    if (node.id === folderId) {
      return node;
    }

    const nestedMatch = findFolderById(node.children, folderId);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
};

export const findNodeById = (
  nodes: WorkspaceNode[],
  nodeId: string,
): WorkspaceNode | null => {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }

    if (node.type === 'folder') {
      const nestedMatch = findNodeById(node.children, nodeId);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }

  return null;
};

export const findConversationNodeId = (
  nodes: WorkspaceNode[],
  conversationId: string,
): string | null => {
  for (const node of nodes) {
    if (node.type === 'conversation' && node.conversationId === conversationId) {
      return node.id;
    }

    if (node.type === 'folder') {
      const nestedMatch = findConversationNodeId(node.children, conversationId);

      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }

  return null;
};

export const findParentFolderId = (
  nodes: WorkspaceNode[],
  targetNodeId: string,
  parentFolderId: string | null = null,
): string | null => {
  const lookupParentFolderId = (
    searchNodes: WorkspaceNode[],
    searchTargetNodeId: string,
    currentParentFolderId: string | null,
  ): string | null | undefined => {
    for (const node of searchNodes) {
      if (node.id === searchTargetNodeId) {
        return currentParentFolderId;
      }

      if (node.type === 'folder') {
        const nestedMatch = lookupParentFolderId(
          node.children,
          searchTargetNodeId,
          node.id,
        );
        if (nestedMatch !== undefined) {
          return nestedMatch;
        }
      }
    }

    return undefined;
  };

  const lookupResult = lookupParentFolderId(
    nodes,
    targetNodeId,
    parentFolderId,
  );

  return lookupResult === undefined ? null : lookupResult;
};

export const collectConversationIds = (nodes: WorkspaceNode[]): string[] =>
  nodes.flatMap((node) =>
    node.type === 'conversation'
      ? [node.conversationId]
      : collectConversationIds(node.children),
  );

export const collectDescendantFolderIds = (
  folderNode: WorkspaceFolderNode,
): string[] =>
  folderNode.children.flatMap((childNode) =>
    childNode.type === 'folder'
      ? [childNode.id, ...collectDescendantFolderIds(childNode)]
      : [],
  );

export const collectDescendantNodeIds = (
  folderNode: WorkspaceFolderNode,
): string[] =>
  folderNode.children.flatMap((childNode) =>
    childNode.type === 'folder'
      ? [childNode.id, ...collectDescendantNodeIds(childNode)]
      : [childNode.id],
  );

export const countTreeItems = (
  nodes: WorkspaceNode[],
): {
  conversationCount: number;
  folderCount: number;
} =>
  nodes.reduce(
    (counts, node) => {
      if (node.type === 'conversation') {
        counts.conversationCount += 1;
        return counts;
      }

      counts.folderCount += 1;
      const childCounts = countTreeItems(node.children);
      counts.folderCount += childCounts.folderCount;
      counts.conversationCount += childCounts.conversationCount;
      return counts;
    },
    {
      conversationCount: 0,
      folderCount: 0,
    },
  );

type RemovedFolderResult = {
  removedFolder: WorkspaceFolderNode | null;
  tree: WorkspaceNode[];
};

export const removeFolderFromTree = (
  nodes: WorkspaceNode[],
  folderId: string,
): RemovedFolderResult => {
  let removedFolder: WorkspaceFolderNode | null = null;

  const nextTree: WorkspaceNode[] = nodes.flatMap<WorkspaceNode>((node) => {
    if (node.type !== 'folder') {
      return [node];
    }

    if (node.id === folderId) {
      removedFolder = node;
      return [];
    }

    const nestedResult = removeFolderFromTree(node.children, folderId);
    if (nestedResult.removedFolder) {
      removedFolder = nestedResult.removedFolder;
      return [
        {
          ...node,
          children: nestedResult.tree,
        },
      ];
    }

    return [node];
  });

  return {
    removedFolder,
    tree: nextTree,
  };
};

export const moveFolderInTree = (
  nodes: WorkspaceNode[],
  folderId: string,
  destinationFolderId: string | null,
): WorkspaceNode[] => {
  const removalResult = removeFolderFromTree(nodes, folderId);

  if (!removalResult.removedFolder) {
    return nodes;
  }

  return insertNodeIntoFolder(
    removalResult.tree,
    destinationFolderId,
    removalResult.removedFolder,
  );
};

type RemovedNodeResult = {
  removedNode: WorkspaceNode | null;
  tree: WorkspaceNode[];
};

export const removeNodeFromTree = (
  nodes: WorkspaceNode[],
  nodeId: string,
): RemovedNodeResult => {
  let removedNode: WorkspaceNode | null = null;

  const nextTree: WorkspaceNode[] = nodes.flatMap<WorkspaceNode>((node) => {
    if (node.id === nodeId) {
      removedNode = node;
      return [];
    }

    if (node.type !== 'folder') {
      return [node];
    }

    const nestedResult = removeNodeFromTree(node.children, nodeId);
    if (nestedResult.removedNode) {
      removedNode = nestedResult.removedNode;
      return [
        {
          ...node,
          children: nestedResult.tree,
        },
      ];
    }

    return [node];
  });

  return {
    removedNode,
    tree: nextTree,
  };
};

export const moveNodeInTree = (
  nodes: WorkspaceNode[],
  nodeId: string,
  destinationFolderId: string | null,
): WorkspaceNode[] => {
  const removalResult = removeNodeFromTree(nodes, nodeId);

  if (!removalResult.removedNode) {
    return nodes;
  }

  return insertNodeIntoFolder(
    removalResult.tree,
    destinationFolderId,
    removalResult.removedNode,
  );
};

type NodeInsertPosition = 'after' | 'before';

const insertNodeRelativeToTarget = (
  nodes: WorkspaceNode[],
  targetNodeId: string,
  nodeToInsert: WorkspaceNode,
  position: NodeInsertPosition,
): WorkspaceNode[] => {
  const targetNodeIndex = nodes.findIndex((node) => node.id === targetNodeId);

  if (targetNodeIndex >= 0) {
    const insertIndex =
      position === 'before' ? targetNodeIndex : targetNodeIndex + 1;

    return [
      ...nodes.slice(0, insertIndex),
      nodeToInsert,
      ...nodes.slice(insertIndex),
    ];
  }

  return nodes.map((node) => {
    if (node.type !== 'folder') {
      return node;
    }

    return {
      ...node,
      children: insertNodeRelativeToTarget(
        node.children,
        targetNodeId,
        nodeToInsert,
        position,
      ),
    };
  });
};

export const moveNodeRelativeToTarget = (
  nodes: WorkspaceNode[],
  nodeId: string,
  targetNodeId: string,
  position: NodeInsertPosition,
): WorkspaceNode[] => {
  const removalResult = removeNodeFromTree(nodes, nodeId);

  if (!removalResult.removedNode) {
    return nodes;
  }

  return insertNodeRelativeToTarget(
    removalResult.tree,
    targetNodeId,
    removalResult.removedNode,
    position,
  );
};

export const canDropNodeInFolder = (
  nodes: WorkspaceNode[],
  nodeId: string,
  destinationFolderId: string | null,
): boolean => {
  const draggedNode = findNodeById(nodes, nodeId);

  if (!draggedNode) {
    return false;
  }

  if (destinationFolderId && !findFolderById(nodes, destinationFolderId)) {
    return false;
  }

  if (draggedNode.type === 'folder') {
    if (destinationFolderId === draggedNode.id) {
      return false;
    }

    const descendantNodeIds = new Set(collectDescendantNodeIds(draggedNode));
    if (destinationFolderId && descendantNodeIds.has(destinationFolderId)) {
      return false;
    }
  }

  return findParentFolderId(nodes, draggedNode.id) !== destinationFolderId;
};

export const canMoveNodeRelativeToTarget = (
  nodes: WorkspaceNode[],
  nodeId: string,
  targetNodeId: string,
  position: NodeInsertPosition,
): boolean => {
  const draggedNode = findNodeById(nodes, nodeId);
  const targetNode = findNodeById(nodes, targetNodeId);

  if (!draggedNode || !targetNode || draggedNode.id === targetNode.id) {
    return false;
  }

  if (draggedNode.type === 'folder') {
    const descendantNodeIds = new Set(collectDescendantNodeIds(draggedNode));

    if (descendantNodeIds.has(targetNodeId)) {
      return false;
    }
  }

  const currentParentFolderId = findParentFolderId(nodes, draggedNode.id);
  const targetParentFolderId = findParentFolderId(nodes, targetNodeId);

  const currentSiblings =
    currentParentFolderId === null
      ? nodes
      : findFolderById(nodes, currentParentFolderId)?.children ?? [];
  const targetSiblings =
    targetParentFolderId === null
      ? nodes
      : findFolderById(nodes, targetParentFolderId)?.children ?? [];
  const currentIndex = currentSiblings.findIndex((node) => node.id === draggedNode.id);
  const targetIndex = targetSiblings.findIndex((node) => node.id === targetNodeId);

  if (currentIndex < 0 || targetIndex < 0) {
    return false;
  }

  if (currentParentFolderId !== targetParentFolderId) {
    return true;
  }

  if (position === 'before') {
    return currentIndex !== targetIndex - 1 && currentIndex !== targetIndex;
  }

  return currentIndex !== targetIndex + 1 && currentIndex !== targetIndex;
};

export const buildFolderOptions = (
  nodes: WorkspaceNode[],
  excludedFolderIds: Set<string> = new Set(),
  depth = 0,
): Array<{
  depth: number;
  id: string;
  name: string;
}> =>
  nodes.flatMap((node) => {
    if (node.type !== 'folder' || excludedFolderIds.has(node.id)) {
      return [];
    }

    return [
      {
        depth,
        id: node.id,
        name: node.name,
      },
      ...buildFolderOptions(node.children, excludedFolderIds, depth + 1),
    ];
  });
