import type { SharedConversationRefreshMode } from '../../../../shared/refresh/sharedConversationRefresh';
import type { GoogleDriveConfigSummary } from '../../../../shared/sync/googleDriveSync';
import {
  initialConversations,
  initialWorkspaceTree,
} from '../../conversations/data/initialConversations';
import { findFirstConversationId, WORKSPACE_ROOT_VALUE } from '../../conversations/lib/workspaceTree';
import type { Conversation } from '../../../types/chat';

export const INITIAL_ACTIVE_CONVERSATION_ID =
  findFirstConversationId(initialWorkspaceTree) || initialConversations[0]?.id || '';
export const DRAWER_DEFAULT_WIDTH = 384;
export const DRAWER_MIN_WIDTH = 88;
export const DRAWER_MAX_WIDTH = 460;
export const DRAWER_COLLAPSE_THRESHOLD = 136;

export type CreateFolderState = {
  folderName: string;
  parentFolderId: string | null;
};

export type MoveFolderState = {
  destinationFolderId: string | null;
  folderId: string;
  folderName: string;
};

export type DeleteFolderState = {
  conversationCount: number;
  folderCount: number;
  folderId: string;
  folderName: string;
};

export type ClearLocalWorkspaceState = {
  conversationCount: number;
  folderCount: number;
};

export type RenameConversationState = {
  conversationId: string;
  currentTitle: string;
  nextTitle: string;
};

export type RenameFolderState = {
  folderId: string;
  folderName: string;
  nextName: string;
};

export type SharedConversationRefreshConfigState = {
  chatUrl: string;
  conversationId: string;
  conversationTitle: string;
  mode: SharedConversationRefreshMode;
  projectUrl: string;
  shareUrl: string;
};

export type SyncConflictState = {
  localSavedAt: string;
  remoteSavedAt: string;
  remoteSignature: string;
};

export type GoogleDriveConfigFormState = {
  clientId: string;
  clientSecret: string;
  hasExistingClientSecret: boolean;
  setupUrl: string;
  source: GoogleDriveConfigSummary['source'];
};

export const getFolderSelectValue = (folderId: string | null): string =>
  folderId ?? WORKSPACE_ROOT_VALUE;

export const parseFolderSelectValue = (value: string): string | null =>
  value === WORKSPACE_ROOT_VALUE ? null : value;

export const formatFolderOptionLabel = (
  folderName: string,
  depth: number,
): string => `${'  '.repeat(depth)}${depth > 0 ? '└ ' : ''}${folderName}`;

export const isRefreshableSharedConversation = (
  conversation: Conversation | null,
): conversation is Conversation & { sourceUrl: string } =>
  !!conversation?.isSharedImport &&
  typeof conversation.sourceUrl === 'string' &&
  conversation.sourceUrl.length > 0;

export const extractFirstHttpUrl = (value: string): string | null =>
  value.match(/https:\/\/[^\s)]+/i)?.[0] ?? null;

export const sanitizeGoogleDriveErrorMessage = (value: string): string =>
  value
    .replace(/https:\/\/[^\s)]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
