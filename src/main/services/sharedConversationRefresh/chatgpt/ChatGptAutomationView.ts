import { BrowserWindow, WebContentsView, type Rectangle, type WebContents } from 'electron';
import {
  ACTIONABLE_SELECTOR,
  buildClickActionAboveScript,
  buildFindAndClickFloatingScript,
  buildClickLinkByUrlScript,
  buildFindAndClickScript,
  buildGetHoverPointForSelectorsScript,
  buildHasButtonScript,
  buildHasTextMarkersScript,
  buildHasVisibleDialogScript,
  type HoverPoint,
  type ChatGptPageSnapshot,
  type SharedUrlCandidateSnapshot,
} from './chatGptAutomationScripts';
import {
  buildStepConversationRowMenuByChatUrlScript,
  type ConversationRowMenuStepResult,
} from './chatGptConversationListScripts';

export const CHATGPT_REFRESH_PARTITION = 'persist:gptviewer-chatgpt-refresh';

const DEFAULT_WINDOW_BOUNDS = { height: 920, width: 1280 };

export class ChatGptAutomationView {
  private static sharedInstance: ChatGptAutomationView | null = null;
  private closed = false;
  private readonly view: WebContentsView;
  private readonly window: BrowserWindow;

  static acquire() {
    if (this.sharedInstance && !this.sharedInstance.isClosed()) {
      this.sharedInstance.window.show();
      this.sharedInstance.window.focus();
      return this.sharedInstance;
    }

    this.sharedInstance = new ChatGptAutomationView();
    return this.sharedInstance;
  }

  constructor() {
    this.window = new BrowserWindow({
      acceptFirstMouse: true,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      height: DEFAULT_WINDOW_BOUNDS.height,
      minHeight: 820,
      minWidth: 1100,
      show: true,
      title: 'ChatGPT 새로고침',
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
    this.window.on('hide', () => {
      this.closed = true;
    });
    this.window.on('close', () => {
      this.closed = true;
    });
    this.window.on('resize', this.syncViewBounds);
    this.window.on('closed', () => {
      this.closed = true;
      if (ChatGptAutomationView.sharedInstance === this) {
        ChatGptAutomationView.sharedInstance = null;
      }
    });
    this.view.webContents.on('destroyed', () => {
      this.closed = true;
    });
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  get webContents(): WebContents { return this.view.webContents; }

  private readonly syncViewBounds = () => {
    if (this.window.isDestroyed()) return;
    const bounds = this.window.getContentBounds();
    this.view.setBounds(this.toViewBounds(bounds));
  };

  private toViewBounds(bounds: Rectangle) {
    return {
      height: Math.max(bounds.height, 1),
      width: Math.max(bounds.width, 1),
      x: 0,
      y: 0,
    };
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
    this.window.show();
    this.window.focus();
    await this.view.webContents.loadURL(url);
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
    if (this.isClosed()) {
      return;
    }
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

  async getPageSnapshot() {
    return this.execute<ChatGptPageSnapshot>(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const actionLabels = Array.from(document.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)}))
          .map((element) => clean(element.textContent || element.getAttribute('aria-label') || element.getAttribute('title')))
          .filter((value, index, items) => value && items.indexOf(value) === index)
          .slice(0, 24);
        return {
          actionLabels,
          bodyText: clean(document.body?.innerText || '').slice(0, 4000),
          currentUrl: window.location.href,
          title: document.title || '',
        };
      })()
    `);
  }

  async getSharedUrlCandidate() {
    const snapshot = await this.execute<SharedUrlCandidateSnapshot>(`
      (() => {
        const pattern = /https:\\/\\/chatgpt\\.com\\/share\\/[\\w-]+/i;
        const normalize = (value) => typeof value === 'string' ? value.trim() : '';
        const candidates = [];

        const pushCandidate = (value) => {
          const normalized = normalize(value);
          if (normalized) {
            candidates.push(normalized);
          }
        };

        const nodes = Array.from(
          document.querySelectorAll('input, textarea, a[href], button, [role="button"], [data-testid], [data-value]'),
        );
        for (const element of nodes) {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            pushCandidate(element.value);
            pushCandidate(element.placeholder);
          }
          if (element instanceof HTMLAnchorElement) {
            pushCandidate(element.href);
          }
          if (element instanceof HTMLElement) {
            pushCandidate(element.getAttribute('data-value'));
            pushCandidate(element.getAttribute('value'));
            pushCandidate(element.getAttribute('aria-label'));
            pushCandidate(element.getAttribute('title'));
            pushCandidate(element.textContent);
          }
        }

        const bodyText = document.body?.innerText || '';
        const matchedTextUrl = bodyText.match(pattern)?.[0] ?? null;
        return {
          currentUrl: normalize(window.location.href),
          matchedTextUrl,
          urls: candidates,
        };
      })()
    `);

    const candidates = [
      snapshot.currentUrl,
      snapshot.matchedTextUrl,
      ...snapshot.urls,
    ];

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
