import type { SharedConversationRefreshErrorCode } from './sharedConversationRefresh';

const REFRESH_ERROR_PREFIX = 'shared-conversation-refresh-error:';

export type DecodedSharedConversationRefreshError = {
  code: SharedConversationRefreshErrorCode;
  detail?: string;
  message: string;
};

export const encodeSharedConversationRefreshError = (
  error: DecodedSharedConversationRefreshError,
): string =>
  `${REFRESH_ERROR_PREFIX}${JSON.stringify(error)}`;

export const decodeSharedConversationRefreshError = (
  value: string,
): DecodedSharedConversationRefreshError | null => {
  if (!value.startsWith(REFRESH_ERROR_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(value.slice(REFRESH_ERROR_PREFIX.length)) as DecodedSharedConversationRefreshError;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.message !== 'string' || typeof parsed.code !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};
