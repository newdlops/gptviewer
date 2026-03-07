import type { SharedConversationRefreshErrorCode } from '../../../shared/refresh/sharedConversationRefresh';

export class SharedConversationRefreshError extends Error {
  readonly code: SharedConversationRefreshErrorCode;
  readonly detail?: string;

  constructor(
    code: SharedConversationRefreshErrorCode,
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = 'SharedConversationRefreshError';
    this.code = code;
    this.detail = detail;
  }
}
