import { BrowserWindow, WebContentsView, type Rectangle, type WebContents } from 'electron';
import {
  buildClickActionAboveScript,
  buildFindAndClickFloatingScript,
  buildClickLinkByUrlScript,
  buildFindAndClickScript,
  buildGetHoverPointForSelectorsScript,
  buildHasButtonScript,
  buildHasTextMarkersScript,
  buildHasVisibleDialogScript,
  type HoverPoint,
} from './chatGptAutomationScripts';
import {
  buildGetButtonPointScript,
  type HoverPoint as ButtonPoint,
} from './chatGptButtonActionScripts';
import {
  buildStepConversationRowMenuByChatUrlScript,
  type ConversationRowMenuStepResult,
} from './chatGptConversationListScripts';
import {
  buildClearClipboardBridgeValueScript,
  buildInstallClipboardBridgeScript,
  buildReadClipboardBridgeValueScript,
} from './chatGptClipboardBridgeScripts';
import {
  buildClearShareResponseBridgeValueScript,
  buildInstallShareResponseBridgeScript,
  buildReadShareNetworkEventsScript,
  buildReadShareResponseBridgeValueScript,
  buildClearShareNetworkEventsScript,
  type ChatGptShareNetworkEvent,
} from './chatGptShareResponseBridgeScripts';
import {
  buildGetPageSnapshotScript,
  buildGetSharedUrlCandidateScript,
  type ChatGptPageSnapshot,
  type SharedUrlCandidateSnapshot,
} from './chatGptPageScripts';

export const CHATGPT_REFRESH_PARTITION = 'persist:gptviewer-chatgpt-refresh';

const DEFAULT_WINDOW_BOUNDS = { height: 920, width: 1280 };

export class ChatGptAutomationView {
  private static sharedInstance: ChatGptAutomationView | null = null;
  private closed = false;
  private readonly view: WebContentsView;
  private readonly window: BrowserWindow;

  static acquire() {
    if (this.sharedInstance && !this.sharedInstance.isClosed()) {
      this.sharedInstance.reveal();
      return this.sharedInstance;
    }
    this.sharedInstance = new ChatGptAutomationView();
    return this.sharedInstance;
  }

  constructor() {
    this.window = new BrowserWindow({
      acceptFirstMouse: true,
      autoHideMenuBar: true,
      height: DEFAULT_WINDOW_BOUNDS.height,
      minHeight: 820,
      minWidth: 1100,
      show: false,
      title: 'ChatGPT 새로고침',
      webPreferences: {
        backgroundThrottling: false,
      },
      width: DEFAULT_WINDOW_BOUNDS.width,
    });
    this.view = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: CHATGPT_REFRESH_PARTITION,
        sandbox: true,
      },
    });
    this.window.contentView.addChildView(this.view);
    this.syncViewBounds();
    this.window.on('close', () => { this.closed = true; });
    this.window.on('resize', this.syncViewBounds);
    this.window.on('closed', () => {
      this.closed = true;
      if (ChatGptAutomationView.sharedInstance === this) {
        ChatGptAutomationView.sharedInstance = null;
      }
    });
    this.view.webContents.on('destroyed', () => { this.closed = true; });
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  get webContents(): WebContents { return this.view.webContents; }

  private readonly syncViewBounds = () => {
    if (this.window.isDestroyed()) return;
    this.view.setBounds(this.toViewBounds(this.window.getContentBounds()));
  };

  private reveal() {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    if (!this.window.isVisible()) {
      this.window.showInactive();
    }
  }

  private toViewBounds(bounds: Rectangle) {
    return { height: Math.max(bounds.height, 1), width: Math.max(bounds.width, 1), x: 0, y: 0 };
  }

  isClosed() { return this.closed || this.window.isDestroyed() || this.view.webContents.isDestroyed(); }

  async close() {
    await this.persistSession();
    if (!this.isClosed()) {
      this.window.hide();
    }
  }

  async execute<T>(script: string): Promise<T> {
    return (await this.view.webContents.executeJavaScript(script, true)) as T;
  }

  async load(url: string) {
    this.reveal();
    await this.view.webContents.loadURL(url);
    await this.installClipboardBridge();
    await this.installShareResponseBridge();
  }

  async hasButtonByLabels(labels: string[], testIds: string[] = []) { return this.execute<boolean>(buildHasButtonScript(labels, testIds)); }
  async hasTextMarkers(markers: string[]) { return this.execute<boolean>(buildHasTextMarkersScript(markers)); }
  async hasVisibleDialog() { return this.execute<boolean>(buildHasVisibleDialogScript()); }
  async tryClickButtonByLabels(labels: string[], testIds: string[] = []) { return this.execute<boolean>(buildFindAndClickScript(labels, testIds)); }
  async tryClickActionAboveButtonByLabels(labels: string[], testIds: string[] = []) { return this.execute<boolean>(buildClickActionAboveScript(labels, testIds)); }

  async stepConversationRowMenuByChatUrl(
    chatUrl: string,
    labels: string[],
    testIds: string[] = [],
    listSelectors: string[] = [],
  ) {
    return this.execute<ConversationRowMenuStepResult>(
      buildStepConversationRowMenuByChatUrlScript(chatUrl, labels, testIds, listSelectors),
    );
  }

  async tryClickLinkByUrl(targetUrl: string) { return this.execute<boolean>(buildClickLinkByUrlScript(targetUrl)); }
  async getHoverPointForSelectors(selectors: string[]) { return this.execute<HoverPoint | null>(buildGetHoverPointForSelectorsScript(selectors)); }

  async moveMouse(x: number, y: number) {
    if (this.isClosed()) return;
    this.view.webContents.sendInputEvent({ type: 'mouseEnter', x, y });
    this.view.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.max(1, x - 6),
      y,
      movementX: 0,
      movementY: 0,
    });
    this.view.webContents.sendInputEvent({
      type: 'mouseMove',
      x,
      y,
      movementX: 6,
      movementY: 0,
    });
  }

  async clickAt(x: number, y: number) {
    if (this.isClosed()) return false;
    await this.moveMouse(x, y);
    this.view.webContents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseDown',
      x,
      y,
    });
    this.view.webContents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseUp',
      x,
      y,
    });
    return true;
  }

  async clickButtonByLabelsViaInput(labels: string[], testIds: string[] = []) {
    const point = await this.getButtonPointByLabels(labels, testIds);
    if (!point) return false;
    return this.clickAt(point.x, point.y);
  }

  async getButtonPointByLabels(labels: string[], testIds: string[] = []) {
    return this.execute<ButtonPoint | null>(buildGetButtonPointScript(labels, testIds));
  }

  private async waitForAction(
    action: () => Promise<boolean>,
    timeoutMs: number,
    intervalMs: number,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.isClosed()) {
      if (await action()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  }

  async waitAndClickFloatingButtonByLabels(
    labels: string[],
    testIds: string[] = [],
    timeoutMs = 12_000,
    intervalMs = 300,
  ) {
    return this.waitForAction(
      () => this.execute<boolean>(
        buildFindAndClickFloatingScript(labels, testIds),
      ),
      timeoutMs,
      intervalMs,
    );
  }

  async waitAndClickButtonByLabels(
    labels: string[],
    testIds: string[] = [],
    timeoutMs = 12_000,
    intervalMs = 300,
  ) {
    return this.waitForAction(
      () => this.execute<boolean>(buildFindAndClickScript(labels, testIds)),
      timeoutMs,
      intervalMs,
    );
  }

  async persistSession() {
    try { await this.view.webContents.session.flushStorageData(); }
    catch { /* Ignore session flush failures; the automation flow should still continue. */ }
  }

  async installClipboardBridge() {
    try { await this.execute<boolean>(buildInstallClipboardBridgeScript()); }
    catch { /* Ignore bridge install failures and continue with DOM/clipboard fallbacks. */ }
  }
  async clearBridgedClipboardText() { return this.execute<boolean>(buildClearClipboardBridgeValueScript()); }
  async getBridgedClipboardText() { return this.execute<string>(buildReadClipboardBridgeValueScript()); }
  async installShareResponseBridge() {
    try { await this.execute<boolean>(buildInstallShareResponseBridgeScript()); }
    catch { /* Ignore bridge install failures and continue with other fallbacks. */ }
  }
  async clearShareNetworkEvents() { return this.execute<boolean>(buildClearShareNetworkEventsScript()); }
  async clearBridgedShareResponseUrl() { return this.execute<boolean>(buildClearShareResponseBridgeValueScript()); }
  async getBridgedShareResponseUrl() { return this.execute<string>(buildReadShareResponseBridgeValueScript()); }
  async getShareNetworkEvents() { return this.execute<ChatGptShareNetworkEvent[]>(buildReadShareNetworkEventsScript()); }

  async getPageSnapshot() {
    return this.execute<ChatGptPageSnapshot>(buildGetPageSnapshotScript());
  }

  async getSharedUrlCandidate() {
    const snapshot = await this.execute<SharedUrlCandidateSnapshot>(
      buildGetSharedUrlCandidateScript(),
    );

    const candidates = [snapshot.currentUrl, snapshot.matchedTextUrl, ...snapshot.urls];

    const matchedUrl = candidates.find((value) =>
      /^https:\/\/chatgpt\.com\/share\/[\w-]+/i.test((value || '').trim()),
    );
    return matchedUrl ?? null;
  }

  async waitForSharedUrlCandidate(timeoutMs = 12_000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.isClosed()) {
      const matchedUrl = await this.getSharedUrlCandidate();
      if (matchedUrl) {
        return matchedUrl;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return null;
  }
}
