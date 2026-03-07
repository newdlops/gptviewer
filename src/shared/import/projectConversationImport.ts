import type { SharedConversationImport } from '../refresh/sharedConversationRefresh';

export type ProjectConversationImportRequest = {
  projectUrl: string;
};

export type ProjectConversationImportConversation = SharedConversationImport & {
  chatUrl: string;
};

export type ProjectConversationImportFailure = {
  chatUrl: string;
  message: string;
  title: string;
};

export type ProjectConversationImportResult = {
  conversations: ProjectConversationImportConversation[];
  failures: ProjectConversationImportFailure[];
  fetchedAt: string;
  projectTitle: string;
  projectUrl: string;
};
