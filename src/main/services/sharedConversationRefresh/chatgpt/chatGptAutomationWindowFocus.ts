import { BrowserWindow } from 'electron';
import { ChatGptAutomationView } from './ChatGptAutomationView';

export const focusAutomationWindow = (automationView: ChatGptAutomationView) => {
  const window = BrowserWindow.fromWebContents(automationView.webContents);
  if (!window || window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.moveTop();
  window.focus();
  automationView.webContents.focus();
};
