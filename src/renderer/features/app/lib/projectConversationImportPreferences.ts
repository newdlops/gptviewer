const PROJECT_CONVERSATION_IMPORT_PREFERENCES_STORAGE_KEY =
  'gptviewer.project-conversation-import-preferences.v1';

export const PROJECT_CONVERSATION_IMPORT_STRATEGY_OPTIONS = [
  { label: '공유 링크 우선', value: 'share-url-first' },
  { label: '원본 링크 우선', value: 'chat-url-first' },
] as const;

export type ProjectConversationImportStrategyPreference =
  (typeof PROJECT_CONVERSATION_IMPORT_STRATEGY_OPTIONS)[number]['value'];

export type ProjectConversationImportPreferences = {
  preferredStrategy: ProjectConversationImportStrategyPreference;
  workerCount: number;
};

export const DEFAULT_PROJECT_CONVERSATION_IMPORT_WORKER_COUNT = 10;
const MAX_PROJECT_CONVERSATION_IMPORT_WORKER_COUNT = 20;
const MIN_PROJECT_CONVERSATION_IMPORT_WORKER_COUNT = 1;

const DEFAULT_PROJECT_CONVERSATION_IMPORT_PREFERENCES: ProjectConversationImportPreferences =
  {
    preferredStrategy: 'share-url-first',
    workerCount: DEFAULT_PROJECT_CONVERSATION_IMPORT_WORKER_COUNT,
  };

const ALLOWED_STRATEGIES = new Set<ProjectConversationImportStrategyPreference>(
  PROJECT_CONVERSATION_IMPORT_STRATEGY_OPTIONS.map((option) => option.value),
);

const normalizeWorkerCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PROJECT_CONVERSATION_IMPORT_WORKER_COUNT;
  }

  const roundedValue = Math.round(value);
  return Math.min(
    MAX_PROJECT_CONVERSATION_IMPORT_WORKER_COUNT,
    Math.max(MIN_PROJECT_CONVERSATION_IMPORT_WORKER_COUNT, roundedValue),
  );
};

const normalizePreferredStrategy = (
  value: unknown,
): ProjectConversationImportStrategyPreference =>
  typeof value === 'string' && ALLOWED_STRATEGIES.has(value as ProjectConversationImportStrategyPreference)
    ? (value as ProjectConversationImportStrategyPreference)
    : DEFAULT_PROJECT_CONVERSATION_IMPORT_PREFERENCES.preferredStrategy;

export const loadProjectConversationImportPreferences =
  (): ProjectConversationImportPreferences => {
    if (typeof window === 'undefined') {
      return DEFAULT_PROJECT_CONVERSATION_IMPORT_PREFERENCES;
    }

    try {
      const rawValue = window.localStorage.getItem(
        PROJECT_CONVERSATION_IMPORT_PREFERENCES_STORAGE_KEY,
      );
      if (!rawValue) {
        return DEFAULT_PROJECT_CONVERSATION_IMPORT_PREFERENCES;
      }

      const parsedValue = JSON.parse(
        rawValue,
      ) as Partial<ProjectConversationImportPreferences>;
      return {
        preferredStrategy: normalizePreferredStrategy(
          parsedValue.preferredStrategy,
        ),
        workerCount: normalizeWorkerCount(parsedValue.workerCount),
      };
    } catch {
      return DEFAULT_PROJECT_CONVERSATION_IMPORT_PREFERENCES;
    }
  };

export const saveProjectConversationImportPreferences = (
  preferences: ProjectConversationImportPreferences,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      PROJECT_CONVERSATION_IMPORT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        preferredStrategy: normalizePreferredStrategy(
          preferences.preferredStrategy,
        ),
        workerCount: normalizeWorkerCount(preferences.workerCount),
      }),
    );
  } catch {
    // Ignore localStorage failures and keep the in-memory preferences.
  }
};
