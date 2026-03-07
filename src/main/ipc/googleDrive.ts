import { ipcMain } from 'electron';
import type { GoogleDriveConfigInput } from '../../shared/sync/googleDriveSync';
import type { WorkspaceSnapshot } from '../../shared/sync/workspaceSnapshot';
import { googleDriveSyncService } from '../services/googleDriveSyncService';

export const registerGoogleDriveSyncIpc = (): void => {
  ipcMain.removeHandler('google-drive-sync:get-config');
  ipcMain.removeHandler('google-drive-sync:get-status');
  ipcMain.removeHandler('google-drive-sync:save-config');
  ipcMain.removeHandler('google-drive-sync:sign-in');
  ipcMain.removeHandler('google-drive-sync:sign-out');
  ipcMain.removeHandler('google-drive-sync:disconnect');
  ipcMain.removeHandler('google-drive-sync:sync-now');
  ipcMain.removeHandler('google-drive-sync:download-snapshot');

  ipcMain.handle('google-drive-sync:get-config', async () =>
    googleDriveSyncService.getConfigSummary(),
  );
  ipcMain.handle('google-drive-sync:get-status', async () =>
    googleDriveSyncService.getStatus(),
  );
  ipcMain.handle(
    'google-drive-sync:save-config',
    async (_event, input: GoogleDriveConfigInput) =>
      googleDriveSyncService.saveConfig(input),
  );
  ipcMain.handle('google-drive-sync:sign-in', async () =>
    googleDriveSyncService.signIn(),
  );
  ipcMain.handle('google-drive-sync:sign-out', async () =>
    googleDriveSyncService.signOut(),
  );
  ipcMain.handle('google-drive-sync:disconnect', async () =>
    googleDriveSyncService.disconnect(),
  );
  ipcMain.handle(
    'google-drive-sync:sync-now',
    async (_event, snapshot: WorkspaceSnapshot) =>
      googleDriveSyncService.uploadSnapshot(snapshot),
  );
  ipcMain.handle('google-drive-sync:download-snapshot', async () =>
    googleDriveSyncService.downloadSnapshot(),
  );
};
