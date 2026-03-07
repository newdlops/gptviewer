import type { WorkspaceSnapshot } from '../../../../shared/sync/workspaceSnapshot';
import {
  buildWorkspaceSnapshot,
  normalizeWorkspaceSnapshot,
  workspaceStateFromSnapshot,
  type WorkspacePersistenceState,
} from './workspaceSnapshot';

const WORKSPACE_STORAGE_KEY = 'gptviewer.workspace-state.v2';
const LEGACY_WORKSPACE_STORAGE_KEYS = ['gptviewer.workspace-state.v1'];

export type { WorkspacePersistenceState } from './workspaceSnapshot';

export type WorkspacePersistenceAdapter = {
  loadSnapshot: () => WorkspaceSnapshot | null;
  saveSnapshot: (snapshot: WorkspaceSnapshot) => void;
};

const createLocalWorkspacePersistenceAdapter = (
  storageKey = WORKSPACE_STORAGE_KEY,
): WorkspacePersistenceAdapter => ({
  loadSnapshot: (): WorkspaceSnapshot | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const rawState = window.localStorage.getItem(storageKey);

      if (!rawState) {
        return null;
      }

      return normalizeWorkspaceSnapshot(JSON.parse(rawState));
    } catch {
      return null;
    }
  },
  saveSnapshot: (snapshot: WorkspaceSnapshot): void => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // Ignore quota or serialization failures and continue with in-memory state.
    }
  },
});

const defaultWorkspacePersistenceAdapter =
  createLocalWorkspacePersistenceAdapter();

const loadLegacyWorkspaceState = (): WorkspacePersistenceState | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  for (const storageKey of LEGACY_WORKSPACE_STORAGE_KEYS) {
    try {
      const rawState = window.localStorage.getItem(storageKey);

      if (!rawState) {
        continue;
      }

      const normalizedSnapshot = normalizeWorkspaceSnapshot({
        ...JSON.parse(rawState),
        savedAt: new Date().toISOString(),
        schemaVersion: 1,
      });

      if (!normalizedSnapshot) {
        continue;
      }

      const nextState = workspaceStateFromSnapshot(normalizedSnapshot);
      savePersistedWorkspaceState(nextState);
      window.localStorage.removeItem(storageKey);
      return nextState;
    } catch {
      continue;
    }
  }

  return null;
};

export const loadPersistedWorkspaceSnapshot = (): WorkspaceSnapshot | null =>
  defaultWorkspacePersistenceAdapter.loadSnapshot();

export const savePersistedWorkspaceSnapshot = (
  snapshot: WorkspaceSnapshot,
): void => {
  defaultWorkspacePersistenceAdapter.saveSnapshot(snapshot);
};

export const loadPersistedWorkspaceState =
  (): WorkspacePersistenceState | null => {
    const snapshot = loadPersistedWorkspaceSnapshot();

    if (snapshot) {
      return workspaceStateFromSnapshot(snapshot);
    }

    return loadLegacyWorkspaceState();
  };

export const savePersistedWorkspaceState = (
  state: WorkspacePersistenceState,
): void => {
  savePersistedWorkspaceSnapshot(buildWorkspaceSnapshot(state));
};
