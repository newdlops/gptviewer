import { type FormEvent, useState } from 'react';
import type { GoogleDriveConfigSummary, GoogleDriveSyncStatus } from '../../../../shared/sync/googleDriveSync';
import type { GoogleDriveConfigFormState } from '../lib/appTypes';

type UseGoogleDriveConfigStateArgs = {
  onSyncStatusChange: (status: GoogleDriveSyncStatus | null) => void;
};

export function useGoogleDriveConfigState({ onSyncStatusChange }: UseGoogleDriveConfigStateArgs) {
  const [googleDriveConfig, setGoogleDriveConfig] = useState<GoogleDriveConfigSummary | null>(null);
  const [googleDriveConfigForm, setGoogleDriveConfigForm] = useState<GoogleDriveConfigFormState | null>(null);
  const [isGoogleDriveConfigModalOpen, setIsGoogleDriveConfigModalOpen] = useState(false);
  const [isSavingGoogleDriveConfig, setIsSavingGoogleDriveConfig] = useState(false);
  const [googleDriveConfigError, setGoogleDriveConfigError] = useState('');

  const openGoogleDriveConfigModal = () => {
    setGoogleDriveConfigError('');
    setGoogleDriveConfigForm({
      clientId: googleDriveConfig?.clientId ?? '',
      clientSecret: '',
      hasExistingClientSecret: googleDriveConfig?.hasClientSecret ?? false,
      setupUrl: googleDriveConfig?.setupUrl ?? 'https://console.cloud.google.com/apis/credentials',
      source: googleDriveConfig?.source ?? 'none',
    });
    setIsGoogleDriveConfigModalOpen(true);
  };

  const closeGoogleDriveConfigModal = () => {
    if (isSavingGoogleDriveConfig) return;
    setGoogleDriveConfigError('');
    setIsGoogleDriveConfigModalOpen(false);
  };

  const handleGoogleDriveConfigSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!googleDriveConfigForm) return;
    const clientId = googleDriveConfigForm.clientId.trim();
    if (!clientId) return setGoogleDriveConfigError('Google OAuth 클라이언트 ID를 입력해 주세요.');

    setGoogleDriveConfigError('');
    setIsSavingGoogleDriveConfig(true);
    try {
      const nextConfig = await window.electronAPI?.saveGoogleDriveConfig({
        clientId,
        clientSecret: googleDriveConfigForm.clientSecret.trim() || undefined,
        keepExistingClientSecret:
          googleDriveConfigForm.hasExistingClientSecret && googleDriveConfigForm.clientSecret.trim().length === 0,
      });
      const nextStatus = await window.electronAPI?.getGoogleDriveSyncStatus();
      setGoogleDriveConfig(nextConfig ?? null);
      onSyncStatusChange(nextStatus ?? null);
      setIsGoogleDriveConfigModalOpen(false);
    } catch (error) {
      setGoogleDriveConfigError(error instanceof Error ? error.message : 'Google Drive 연동 설정을 저장하지 못했습니다.');
    } finally {
      setIsSavingGoogleDriveConfig(false);
    }
  };

  return {
    closeGoogleDriveConfigModal,
    googleDriveConfig,
    googleDriveConfigError,
    googleDriveConfigForm,
    handleGoogleDriveConfigSave,
    isGoogleDriveConfigModalOpen,
    isSavingGoogleDriveConfig,
    openGoogleDriveConfigModal,
    setGoogleDriveConfig,
    setGoogleDriveConfigForm,
  };
}
