const SHARED_CONVERSATION_IMPORT_PREFERENCES_STORAGE_KEY =
  'gptviewer.shared-conversation-import-preferences.v1';

export const SHARED_CONVERSATION_IMPORT_STRATEGY_OPTIONS = [
  { label: '공유 대화 URL 우선', value: 'share-url-first' },
  { label: '원본 링크 우선', value: 'chat-url-first' },
] as const;

export type SharedConversationImportStrategyPreference =
  (typeof SHARED_CONVERSATION_IMPORT_STRATEGY_OPTIONS)[number]['value'];

export type SharedConversationImportPreferences = {
  preferredStrategy: SharedConversationImportStrategyPreference;
};

const DEFAULT_SHARED_CONVERSATION_IMPORT_PREFERENCES: SharedConversationImportPreferences =
  {
    preferredStrategy: 'share-url-first',
  };

const ALLOWED_STRATEGIES = new Set<SharedConversationImportStrategyPreference>(
  SHARED_CONVERSATION_IMPORT_STRATEGY_OPTIONS.map((option) => option.value),
);

const normalizePreferredStrategy = (
  value: unknown,
): SharedConversationImportStrategyPreference =>
  typeof value === 'string' && ALLOWED_STRATEGIES.has(value as SharedConversationImportStrategyPreference)
    ? (value as SharedConversationImportStrategyPreference)
    : DEFAULT_SHARED_CONVERSATION_IMPORT_PREFERENCES.preferredStrategy;

export const loadSharedConversationImportPreferences =
  (): SharedConversationImportPreferences => {
    if (typeof window === 'undefined') {
      return DEFAULT_SHARED_CONVERSATION_IMPORT_PREFERENCES;
    }

    try {
      const rawValue = window.localStorage.getItem(
        SHARED_CONVERSATION_IMPORT_PREFERENCES_STORAGE_KEY,
      );
      if (!rawValue) {
        return DEFAULT_SHARED_CONVERSATION_IMPORT_PREFERENCES;
      }

      const parsedValue = JSON.parse(
        rawValue,
      ) as Partial<SharedConversationImportPreferences>;
      return {
        preferredStrategy: normalizePreferredStrategy(
          parsedValue.preferredStrategy,
        ),
      };
    } catch {
      return DEFAULT_SHARED_CONVERSATION_IMPORT_PREFERENCES;
    }
  };

export const saveSharedConversationImportPreferences = (
  preferences: SharedConversationImportPreferences,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      SHARED_CONVERSATION_IMPORT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        preferredStrategy: normalizePreferredStrategy(
          preferences.preferredStrategy,
        ),
      }),
    );
  } catch {
    // Ignore localStorage failures and keep the in-memory preferences.
  }
};
