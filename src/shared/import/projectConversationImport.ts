import type { SharedConversationImport } from '../refresh/sharedConversationRefresh';

export type ProjectConversationImportRequest = {
  projectUrl: string;
};

export type ProjectConversationLink = {
  chatUrl: string;
  title: string;
};

export type ProjectConversationImportMode = 'import' | 'sync';

export type ProjectConversationSyncSummary = {
  collectedCount: number;
  matchedCount: number;
  missingCount: number;
  viewerCreatedCount: number;
};

export type ProjectConversationImportConversation = SharedConversationImport & {
  chatUrl: string;
};

export type ProjectConversationImportFailure = {
  chatUrl: string;
  message: string;
  retryCount: number;
  status: 'retryable' | 'retrying' | 'failed';
  title: string;
};

export type ProjectConversationImportProgress =
  | {
      collectedCount: number;
      listItemCount: number;
      phase: 'collecting';
      projectTitle?: string;
    }
  | {
      current: number;
      failedCount: number;
      phase: 'importing';
      title: string;
      total: number;
    }
  | {
      failedCount: number;
      importedCount: number;
      phase: 'completed';
      total: number;
    };

export type ProjectConversationImportResult = {
  conversations: ProjectConversationImportConversation[];
  failures: ProjectConversationImportFailure[];
  fetchedAt: string;
  projectTitle: string;
  projectUrl: string;
};

export type ProjectConversationCollectionResult = {
  conversations: ProjectConversationLink[];
  fetchedAt: string;
  projectTitle: string;
  projectUrl: string;
};
