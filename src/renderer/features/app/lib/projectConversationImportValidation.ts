import type {
  Dispatch,
  SetStateAction,
} from 'react';
import type {
  ProjectConversationImportFailure,
  ProjectConversationImportProgress,
  ProjectConversationLink,
} from '../../../../shared/import/projectConversationImport';
import { reconcileProjectConversationFailures } from './projectConversationImportHelpers';

export const applyProjectImportValidationState = ({
  collectedConversations,
  failures,
  importedChatUrls,
  overrideErrorMessage = '',
  setProjectImportError,
  setProjectImportFailures,
  setProjectImportProgress,
}: {
  collectedConversations: ProjectConversationLink[];
  failures: ProjectConversationImportFailure[];
  importedChatUrls: Set<string>;
  overrideErrorMessage?: string;
  setProjectImportError: Dispatch<SetStateAction<string>>;
  setProjectImportFailures: Dispatch<
    SetStateAction<ProjectConversationImportFailure[]>
  >;
  setProjectImportProgress: Dispatch<
    SetStateAction<ProjectConversationImportProgress | null>
  >;
}) => {
  const validation = reconcileProjectConversationFailures({
    collectedConversations,
    failures,
    importedChatUrls,
  });
  setProjectImportFailures(validation.failures);
  setProjectImportProgress({
    failedCount: validation.failures.length,
    importedCount: validation.importedCount,
    phase: 'completed',
    total: validation.expectedCount,
  });
  setProjectImportError(overrideErrorMessage || validation.validationMessage);
  return validation.failures;
};
