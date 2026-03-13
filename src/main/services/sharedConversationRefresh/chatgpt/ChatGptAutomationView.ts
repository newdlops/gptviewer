import { BrowserWindow, WebContentsView, screen, session, type Rectangle, type WebContents } from 'electron';
import {
  buildClickActionAboveScript,
  buildFindAndClickFloatingScript,
  buildClickLinkByUrlScript,
  buildFindAndClickScript,
  buildGetHoverPointForSelectorsScript,
  buildHasButtonScript,
  buildHasTextMarkersScript,
  buildHasVisibleDialogScript,
  buildIsRespondingScript,
  buildSendMessageScript,
  buildSendMessageViaApiScript,
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
import {
  ChatGptConversationNetworkMonitor,
} from './chatGptConversationNetworkMonitor';

export const CHATGPT_REFRESH_PARTITION = 'persist:gptviewer-chatgpt-refresh';

const DEFAULT_WINDOW_BOUNDS = { height: 920, width: 1280 };
const BACKGROUND_WINDOW_OPACITY = 0.01;
const BACKGROUND_WINDOW_VISIBLE_PEEK = 1;
export type ChatGptAutomationVisibilityMode = 'background' | 'visible';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getBackgroundWindowBounds(anchorWindow: BrowserWindow | null) {
  const display = anchorWindow && !anchorWindow.isDestroyed()
    ? screen.getDisplayMatching(anchorWindow.getBounds())
    : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(DEFAULT_WINDOW_BOUNDS.width, workArea.width);
  const height = Math.min(DEFAULT_WINDOW_BOUNDS.height, workArea.height);
  const x = workArea.x + workArea.width - BACKGROUND_WINDOW_VISIBLE_PEEK;
  const y = workArea.y + workArea.height - BACKGROUND_WINDOW_VISIBLE_PEEK;
  return { height, width, x, y };
}

function getForegroundWindowBounds(anchorWindow: BrowserWindow | null) {
  const display = anchorWindow && !anchorWindow.isDestroyed()
    ? screen.getDisplayMatching(anchorWindow.getBounds())
    : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(DEFAULT_WINDOW_BOUNDS.width, workArea.width);
  const height = Math.min(DEFAULT_WINDOW_BOUNDS.height, workArea.height);
  const x = workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2));
  const y = workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2));
  return { height, width, x, y };
}

export class ChatGptAutomationView {
  private static readonly allViews = new Set<ChatGptAutomationView>();
  private static readonly backgroundIdleViews: ChatGptAutomationView[] = [];
  private readonly anchorWindow: BrowserWindow | null;
  private closed = false;
  private conversationNetworkMonitor: ChatGptConversationNetworkMonitor | null = null;
  private inBackgroundPool = false;
  private readonly view: WebContentsView;
  private readonly visibilityMode: ChatGptAutomationVisibilityMode;
  private readonly window: BrowserWindow;

  private static removeBackgroundIdleView(view: ChatGptAutomationView) {
    const pooledIndex = ChatGptAutomationView.backgroundIdleViews.indexOf(view);
    if (pooledIndex >= 0) {
      ChatGptAutomationView.backgroundIdleViews.splice(pooledIndex, 1);
    }
  }

  static async acquire(
    visibilityMode: ChatGptAutomationVisibilityMode = 'visible',
  ) {
    if (visibilityMode === 'background') {
      const pooledView = ChatGptAutomationView.backgroundIdleViews.pop();
      if (pooledView && !pooledView.isClosed()) {
        pooledView.inBackgroundPool = false;
        return pooledView;
      }
    }
    return new ChatGptAutomationView(visibilityMode);
  }

  static async drainBackgroundPool() {
    const pooledViews = [...ChatGptAutomationView.backgroundIdleViews];
    ChatGptAutomationView.backgroundIdleViews.length = 0;
    await Promise.all(
      pooledViews.map(async (pooledView) => {
        await pooledView.destroyImmediately();
      }),
    );
  }

  static async resetSessionState() {
    const activeViews = [...ChatGptAutomationView.allViews];
    ChatGptAutomationView.backgroundIdleViews.length = 0;
    await Promise.all(
      activeViews.map(async (view) => {
        await view.destroyImmediately();
      }),
    );

    const automationSession = session.fromPartition(CHATGPT_REFRESH_PARTITION);

    try {
      await automationSession.clearAuthCache();
    } catch {
      // Ignore auth cache reset failures.
    }

    try {
      const cookies = await automationSession.cookies.get({});
      await Promise.all(
        cookies.map(async (cookie) => {
          const domain = cookie.domain?.replace(/^\./, '');
          if (!domain) {
            return;
          }

          const removalUrl = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
          try {
            await automationSession.cookies.remove(removalUrl, cookie.name);
          } catch {
            // Ignore individual cookie removal failures.
          }
        }),
      );
    } catch {
      // Ignore cookie enumeration failures.
    }

    try {
      await automationSession.clearStorageData({
        storages: [
          'cookies',
          'filesystem',
          'indexdb',
          'localstorage',
          'shadercache',
          'websql',
          'serviceworkers',
          'cachestorage',
        ],
      });
    } catch {
      // Ignore storage clearing failures; cache clearing still runs below.
    }

    try {
      await automationSession.clearCache();
    } catch {
      // Ignore cache clearing failures.
    }

    try {
      await automationSession.flushStorageData();
    } catch {
      // Ignore flush failures after reset.
    }
  }

  constructor(visibilityMode: ChatGptAutomationVisibilityMode) {
    this.visibilityMode = visibilityMode;
    this.anchorWindow =
      visibilityMode === 'background' ? BrowserWindow.getFocusedWindow() : null;
    const backgroundBounds =
      visibilityMode === 'background' ? getBackgroundWindowBounds(this.anchorWindow) : null;
    this.window = new BrowserWindow({
      acceptFirstMouse: true,
      autoHideMenuBar: true,
      height: backgroundBounds?.height ?? DEFAULT_WINDOW_BOUNDS.height,
      minHeight: 820,
      minWidth: 1100,
      show: false,
      skipTaskbar: visibilityMode === 'background',
      title: 'ChatGPT 새로고침',
      webPreferences: {
        backgroundThrottling: false,
      },
      width: backgroundBounds?.width ?? DEFAULT_WINDOW_BOUNDS.width,
      x: backgroundBounds?.x,
      y: backgroundBounds?.y,
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
      ChatGptAutomationView.removeBackgroundIdleView(this);
      ChatGptAutomationView.allViews.delete(this);
    });
    this.view.webContents.on('destroyed', () => {
      this.closed = true;
      ChatGptAutomationView.removeBackgroundIdleView(this);
      ChatGptAutomationView.allViews.delete(this);
    });
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ChatGptAutomationView.allViews.add(this);
  }

  static async destroyAll() {
    const activeViews = [...ChatGptAutomationView.allViews];
    ChatGptAutomationView.backgroundIdleViews.length = 0;
    await Promise.all(
      activeViews.map(async (view) => {
        await view.destroyImmediately();
      }),
    );
  }

  get webContents(): WebContents { return this.view.webContents; }

  private readonly syncViewBounds = () => {
    if (this.window.isDestroyed()) return;
    this.view.setBounds(this.toViewBounds(this.window.getContentBounds()));
  };

  private showBackgroundWindow() {
    if (this.window.isDestroyed()) return;
    
    // If it's already visible in background, don't keep calling showInactive
    // which might cause flashes or pop-ups on some OSs.
    if (this.window.isVisible() && this.window.getOpacity() === BACKGROUND_WINDOW_OPACITY) {
        return;
    }

    this.window.setOpacity(BACKGROUND_WINDOW_OPACITY);
    this.window.setSkipTaskbar(true);
    this.window.setBounds(getBackgroundWindowBounds(this.anchorWindow), false);
    if (this.window.isMinimized()) this.window.restore();
    this.window.showInactive();
  }

  private reveal() {
    if (this.window.isDestroyed()) return;
    if (this.visibilityMode === 'background') {
      this.showBackgroundWindow();
      return;
    }
    if (this.window.isMinimized()) this.window.restore();
    this.window.setOpacity(1);
    if (!this.window.isVisible()) {
      this.window.showInactive();
    }
  }

  private toViewBounds(bounds: Rectangle) {
    return { height: Math.max(bounds.height, 1), width: Math.max(bounds.width, 1), x: 0, y: 0 };
  }

  isClosed() { return this.closed || this.window.isDestroyed() || this.view.webContents.isDestroyed(); }

  getConversationNetworkMonitor() {
    return this.conversationNetworkMonitor;
  }

  async close() {
    await this.persistSession();
    if (this.visibilityMode === 'background' && !this.isClosed()) {
      await this.releaseToBackgroundPool();
      return;
    }
    if (this.conversationNetworkMonitor) {
      await this.conversationNetworkMonitor.dispose();
    }
    if (!this.isClosed()) {
      this.window.destroy();
    }
  }

  private async destroyImmediately() {
    this.inBackgroundPool = false;
    ChatGptAutomationView.removeBackgroundIdleView(this);
    if (this.conversationNetworkMonitor) {
      await this.conversationNetworkMonitor.dispose();
      this.conversationNetworkMonitor = null;
    }
    if (!this.isClosed()) {
      this.window.destroy();
    }
    ChatGptAutomationView.allViews.delete(this);
  }

  private async releaseToBackgroundPool() {
    if (this.isClosed() || this.inBackgroundPool) {
      return;
    }

    try {
      this.view.webContents.stop();
    } catch {
      // Ignore stop failures on pooled background views.
    }
    this.conversationNetworkMonitor?.clear();
    if (!this.window.isDestroyed()) {
      this.showBackgroundWindow();
    }
    this.inBackgroundPool = true;
    ChatGptAutomationView.backgroundIdleViews.push(this);
  }

  async presentForAttention() {
    if (this.isClosed()) return;
    const foregroundBounds = getForegroundWindowBounds(this.anchorWindow);
    this.window.setSkipTaskbar(false);
    this.window.setOpacity(1);
    this.window.setBounds(foregroundBounds, false);
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.moveTop();
    this.window.focus();
  }

  async enableConversationNetworkMonitoring() {
    console.info('[gptviewer][automation-view] revealing view for monitoring...');
    this.reveal();

    if (!this.conversationNetworkMonitor) {
      console.info('[gptviewer][automation-view] creating network monitor...');
      this.conversationNetworkMonitor = new ChatGptConversationNetworkMonitor(
        this.view.webContents,
      );
    }

    console.info('[gptviewer][automation-view] waiting for monitor ready...');
    await this.conversationNetworkMonitor.ready();
    this.conversationNetworkMonitor.clear();
    console.info('[gptviewer][automation-view] network monitoring enabled.');
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

  getConversationNetworkRecords() {
    return this.conversationNetworkMonitor?.getRecords() ?? [];
  }

  getLatestBackendApiHeaders() {
    return this.conversationNetworkMonitor?.getLatestBackendApiHeaders() ?? null;
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

  async sendMessage(message: string, model?: string) {
    console.info(`[gptviewer][automation-view] Attempting to send message via API (Primary) with model: ${model || 'auto'}...`);
    try {
      const apiResult = await this.sendMessageViaApi(message, model);
      if (apiResult.success) {
        console.info('[gptviewer][automation-view] Message sent successfully via API.');
        return apiResult;
      }
      console.warn(`[gptviewer][automation-view] API send failed: ${apiResult.error}. Falling back to DOM...`);
    } catch (err) {
      console.error(`[gptviewer][automation-view] API send exception: ${err}. Falling back to DOM...`);
    }

    // DOM Fallback
    console.info('[gptviewer][automation-view] Attempting to send message via DOM (Fallback)...');
    try {
      const domResult = await this.execute<{ success: boolean; error?: string }>(buildSendMessageScript(message));
      if (domResult.success) {
        console.info('[gptviewer][automation-view] Message sent successfully via DOM.');
      } else {
        console.error(`[gptviewer][automation-view] DOM send also failed: ${domResult.error}`);
      }
      return domResult;
    } catch (err) {
      console.error(`[gptviewer][automation-view] DOM send exception: ${err}`);
      return { success: false, error: 'Both API and DOM send methods failed' };
    }
  }

  async sendMessageViaApi(message: string, model?: string) {
    if (!this.conversationNetworkMonitor) {
        return { success: false, error: 'Network monitor not initialized' };
    }

    console.info(`[gptviewer][automation-view] Sending message via 4-step Sentinel flow (model: ${model || 'auto'})...`);
    
    const logHandler = (event: any, level: number, message: string, line: number, sourceId: string) => {
        if (message.includes('[gptviewer-script][API]')) {
            console.log(`[Browser Console] ${message}`);
        }
    };
    this.view.webContents.on('console-message', logHandler);

    try {
        // --- PRE-STEP: Wait for Authorization header (max 5s) ---
        let initialHeaders = this.conversationNetworkMonitor.getLatestBackendApiHeaders();
        let retryCount = 0;
        while ((!initialHeaders || !initialHeaders.headers['authorization']) && retryCount < 10) {
            console.warn(`[gptviewer][sentinel-flow] Waiting for Authorization header... (${retryCount + 1}/10)`);
            await new Promise(r => setTimeout(r, 500));
            initialHeaders = this.conversationNetworkMonitor.getLatestBackendApiHeaders();
            retryCount++;
        }

        if (!initialHeaders || !initialHeaders.headers['authorization']) {
            console.error('[gptviewer][sentinel-flow] FAILED to capture Authorization header after 5s.');
            this.view.webContents.removeListener('console-message', logHandler);
            return { success: false, error: 'auth_capture_timeout' };
        }

        console.info('[gptviewer][sentinel-flow] Authorization header secured. Proceeding to Step 1.');

        // --- STEP 1: Conversation Prepare ---
        console.info('[gptviewer][sentinel-flow] Executing Step 1: /conversation/prepare');
        const step1Result = await this.execute<{ success: boolean; conduitToken?: string; parentMessageId?: string; error?: string; status?: number }>(`
            (async () => {
                try {
                    const urlParts = window.location.pathname.split('/');
                    const conversationId = urlParts[urlParts.length - 1];
                    
                    if (!conversationId || conversationId === 'c') {
                        return { success: false, error: 'context_missing' };
                    }

                    const headers = {
                        'Content-Type': 'application/json',
                        ...${JSON.stringify(initialHeaders.headers)}
                    };

                    console.log('[gptviewer-script][API] Fetching conversation data for current_node...');
                    const convoRes = await fetch(\`/backend-api/conversation/\${conversationId}\`, {
                        method: 'GET',
                        headers: headers
                    });

                    if (!convoRes.ok) {
                        return { success: false, error: 'failed_to_fetch_conversation' };
                    }
                    const convoData = await convoRes.json();
                    const parentMessageId = convoData.current_node;

                    if (!parentMessageId) {
                        return { success: false, error: 'current_node_missing' };
                    }

                    const payload = {
                        action: "next",
                        conversation_id: conversationId,
                        parent_message_id: parentMessageId,
                        model: ${JSON.stringify(model || 'auto')},
                        partial_query: {
                            id: crypto.randomUUID(),
                            author: { role: "user" },
                            content: { content_type: "text", parts: [${JSON.stringify(message)}] }
                        },
                        client_contextual_info: { app_name: "chatgpt.com" }
                    };

                    console.log('[gptviewer-script][API] Step 1 Requesting with Auth Header Presence:', !!headers['authorization']);

                    const response = await fetch('https://chatgpt.com/backend-api/f/conversation/prepare', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const err = await response.text();
                        console.error('[gptviewer-script][API] /prepare failed!', response.status, err);
                        return { success: false, error: 'api_fail', status: response.status };
                    }
                    const data = await response.json();
                    return { success: data.status === 'ok', conduitToken: data.conduit_token, parentMessageId: parentMessageId };
                } catch (e) { return { success: false, error: e.message }; }
            })()
        `);

        if (!step1Result.success || !step1Result.conduitToken) {
            console.error('[gptviewer][sentinel-flow] Step 1 failed:', step1Result.error);
            this.view.webContents.removeListener('console-message', logHandler);
            return { success: false, error: 'step1_failed' };
        }

        // --- STEP 2 & 3: Trigger Sentinel Wakeup ---
        console.info('[gptviewer][sentinel-flow] Executing Step 2 & 3: Waking up Sentinel...');
        await this.execute(`
            (() => {
                const textarea = document.getElementById('prompt-textarea');
                if (textarea) {
                    textarea.dispatchEvent(new Event('focus', { bubbles: true }));
                    textarea.value = ' '; 
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    setTimeout(() => {
                        textarea.value = '';
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    }, 100);
                }
            })()
        `);

        // Wait for the background finalize to complete and be caught by NetworkMonitor
        await new Promise(r => setTimeout(r, 2000));
        
        // --- STEP 4: Actual Conversation ---
        // Get fresh headers (this will include the newly mapped sentinel tokens)
        let finalHeaders = this.conversationNetworkMonitor.getLatestBackendApiHeaders();
        if (!finalHeaders || !finalHeaders.headers['authorization']) {
            console.warn('[gptviewer][sentinel-flow] No valid auth headers found for Step 4.');
            this.view.webContents.removeListener('console-message', logHandler);
            return { success: false, error: 'auth_headers_missing' };
        }

        console.info('[gptviewer][sentinel-flow] Executing Step 4: /conversation with full sentinel headers');
        const result = await this.execute<{ success: boolean; error?: string; status?: number }>(`
            (async () => {
                try {
                    const urlParts = window.location.pathname.split('/');
                    const conversationId = urlParts[urlParts.length - 1];
                    const parentMessageId = ${JSON.stringify(step1Result.parentMessageId)};

                    const headers = {
                        ...${JSON.stringify(finalHeaders.headers)},
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream',
                        'x-conduit-token': ${JSON.stringify(step1Result.conduitToken)},
                        'x-openai-target-path': '/backend-api/f/conversation'
                    };

                    console.log('[gptviewer-script][API] Step 4 Headers:', Object.keys(headers));

                    const payload = {
                        action: "next",
                        messages: [
                            {
                                id: crypto.randomUUID(),
                                author: { role: "user" },
                                content: { content_type: "text", parts: [${JSON.stringify(message)}] },
                                metadata: {
                                    developer_mode_connector_ids: [],
                                    selected_sources: [],
                                    selected_github_repos: [],
                                    selected_all_github_repos: false,
                                    serialization_metadata: { custom_symbol_offsets: [] }
                                }
                            }
                        ],
                        conversation_id: conversationId,
                        parent_message_id: parentMessageId,
                        model: ${JSON.stringify(model || 'gpt-5-3')},
                        timezone_offset_min: -540,
                        timezone: "Asia/Seoul",
                        conversation_mode: { kind: "primary_assistant" },
                        enable_message_followups: true,
                        system_hints: [],
                        supports_buffering: true,
                        supported_encodings: ["v1"],
                        client_contextual_info: {
                            is_dark_mode: false,
                            time_since_loaded: 88,
                            page_height: window.innerHeight,
                            page_width: window.innerWidth,
                            pixel_ratio: window.devicePixelRatio || 1,
                            screen_height: window.screen.height,
                            screen_width: window.screen.width,
                            app_name: "chatgpt.com"
                        },
                        paragen_cot_summary_display_override: "allow",
                        force_parallel_switch: "auto"
                    };

                    const response = await fetch('https://chatgpt.com/backend-api/f/conversation', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const txt = await response.text();
                        console.error('[gptviewer-script][API] /conversation failed!', JSON.stringify({ status: response.status, body: txt }));
                        return { success: false, error: 'api_fail', status: response.status };
                    }
                    return { success: true };
                } catch (e) { return { success: false, error: e.message }; }
            })()
        `);

        this.view.webContents.removeListener('console-message', logHandler);
        return result;
    } catch (e) {
        this.view.webContents.removeListener('console-message', logHandler);
        throw e;
    }
  }

  async isResponding() {
    return this.execute<boolean>(buildIsRespondingScript());
  }

  async waitForResponseCompletion(timeoutMs = 30_000, intervalMs = 1_000) {
    console.info('[gptviewer] waitForResponseCompletion started');
    const deadline = Date.now() + timeoutMs;
    
    console.info('[gptviewer] Waiting for response to start...');
    let hasStarted = false;
    let startCheckCount = 0;
    while (Date.now() < deadline && !this.isClosed() && !hasStarted) {
      startCheckCount++;
      const responding = await this.isResponding();
      
      if (startCheckCount % 2 === 0) {
          console.info(`[gptviewer] Start check ${startCheckCount}: isResponding=${responding}`);
      }

      if (responding) {
        hasStarted = true;
        console.info('[gptviewer] Response started generating.');
        break;
      }
      await sleep(intervalMs / 2);
      
      if (startCheckCount > 30) { // 15 seconds max wait for start
          console.warn('[gptviewer] Response did not start after 15s. Proceeding to finish check.');
          break;
      }
    }

    console.info('[gptviewer] Waiting for response to finish...');
    let finishCheckCount = 0;
    while (Date.now() < deadline && !this.isClosed()) {
      finishCheckCount++;
      const responding = await this.isResponding();
      const hasPing = this.conversationNetworkMonitor?.hasCapturedUrl('/backend-api/sentinel/ping') ?? false;
      const hasLatR = this.conversationNetworkMonitor?.hasCapturedUrl('/backend-api/lat/') ?? false;
      
      if (finishCheckCount % 2 === 0) {
          console.info(`[gptviewer] Finish check ${finishCheckCount}: isResponding=${responding} hasPing=${hasPing} hasLatR=${hasLatR}`);
      }

      if (hasLatR) {
          console.info('[gptviewer] /backend-api/lat/ captured. Response completion confirmed via network.');
          await sleep(1000); 
          return true;
      }

      if (!responding) {
        console.info('[gptviewer] No longer responding (DOM), double checking in 2s...');
        await sleep(2000);
        const stillResponding = await this.isResponding();
        const hasLatRNow = this.conversationNetworkMonitor?.hasCapturedUrl('/backend-api/lat/') ?? false;
        console.info(`[gptviewer] Double check: isResponding=${stillResponding} hasLatR=${hasLatRNow}`);
        
        if (hasLatRNow || !stillResponding) {
          console.info('[gptviewer] waitForResponseCompletion confirmed finished.');
          await sleep(2000); // Buffer for UI to settle
          return true;
        }
      }
      
      await sleep(intervalMs);
    }
    
    console.warn(`[gptviewer] waitForResponseCompletion timed out after ${timeoutMs}ms or window closed (closed=${this.isClosed()})`);
    return false;
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
