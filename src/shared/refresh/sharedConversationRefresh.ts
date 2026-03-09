export type SharedConversationRefreshMode =
  | 'direct-share-page'
  | 'direct-chat-page'
  | 'chatgpt-share-flow';

export type SharedConversationRefreshErrorCode =
  | 'chat_url_missing'
  | 'clipboard_read_failed'
  | 'login_required'
  | 'share_button_not_found'
  | 'share_update_button_not_found'
  | 'window_closed'
  | 'unknown';

export type SharedConversationSource = {
  attribution?: string;
  description?: string;
  iconUrl?: string;
  publisher?: string;
  title: string;
  url: string;
};

export type SharedConversationMessage = {
  role: 'assistant' | 'user';
  text: string;
  sources: SharedConversationSource[];
};

export type SharedConversationImportWarning = {
  code: 'shared-deep-research-partial' | 'chat-import-may-be-slow';
  message: string;
};

export type SharedConversationRefreshRequest = {
  chatUrl?: string;
  conversationTitle?: string;
  helperWindowMode?: 'background' | 'visible';
  mode?: SharedConversationRefreshMode;
  projectUrl?: string;
  shareUrl: string;
};

export type SharedConversationImport = {
  fetchedAt: string;
  importOrigin?: 'chat-url';
  importWarning?: SharedConversationImportWarning;
  messages: SharedConversationMessage[];
  refreshRequest?: SharedConversationRefreshRequest;
  sourceUrl: string;
  summary: string;
  title: string;
};

export type SharedConversationRefreshResult = SharedConversationImport & {
  refreshedAt: string;
  resolvedShareUrl: string;
  strategy: SharedConversationRefreshMode;
};

export type SharedConversationRefreshFailure = {
  code: SharedConversationRefreshErrorCode;
  detail?: string;
  message: string;
};
