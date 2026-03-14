import type { WebContents } from 'electron';

export type ChatGptConversationNetworkRecord = {
  bodyText: string;
  mimeType?: string;
  resourceType?: string;
  status: number;
  url: string;
};

export type CapturedBackendApiRequestHeaders = {
  headers: Record<string, string>;
  method: string;
  statusCode: number;
  url: string;
};

type PendingResponseMeta = {
  mimeType?: string;
  resourceType?: string;
  status: number;
  url: string;
};

type PendingRequestMeta = {
  headers: Record<string, string>;
  method: string;
  url: string;
};

const MAX_RECORDS = 200;
const MAX_BODY_LENGTH = 2_000_000;
const BACKEND_API_PREFIX = 'https://chatgpt.com/backend-api/';
const RELEVANT_HOST_PATTERNS = [
  'chatgpt.com',
  'oaiusercontent.com',
  'openai.com',
];

/**
 * Logging Flags for Network Monitor
 * Set to true to enable specific log categories.
 */
export const MONITOR_LOG_FLAGS = {
    SHOW_REQUEST_HEADERS: true,
    SHOW_RESPONSE_HEADERS: false,
    SHOW_REQUEST_BODY: true,
    SHOW_RESPONSE_BODY: true,
    SHOW_STREAM_EVENTS: true,
    SHOW_WEBSOCKET_MESSAGES: true,
    SHOW_BACKUP_REQUESTS: false,
    SHOW_GENERAL_REQUESTS: false,
    SHOW_AUTH_CAPTURE: false,
    SHOW_MAPPING: false,
    SHOW_RESUME_STREAM: true,
    SHOW_WS_URL_CAPTURE: true,
};

// 로그를 관찰할 주요 대상 API 경로들
const TARGET_URLS = [
    '/sentinel/chat-requirements',
    '/backend-api/f/conversation',
    '/backend-api/celsius/ws/user'
];

const isTargetUrl = (url: string) => TARGET_URLS.some(target => url.includes(target));

const normalizeHeaders = (headers: Record<string, string | string[]>) => {
  const normalized: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    normalized[normalizedKey] = Array.isArray(value) ? value.join(', ') : value;
  });
  return normalized;
};

const sanitizeHeadersForReplay = (headers: Record<string, string>) => {
  const sanitized: Record<string, string> = {};
  const blockedHeaderPattern =
    /^(host|connection|content-length|origin|referer|accept-encoding|priority|sec-fetch-.*|sec-ch-.*|:.*)$/i;

  Object.entries(headers).forEach(([key, value]) => {
    const k = key.toLowerCase();
    if (!value || blockedHeaderPattern.test(key) || k === 'cookie') {
      return;
    }
    sanitized[key] = value;
  });
  return sanitized;
};

const isRelevantContentType = (mimeType?: string): boolean => {
  const normalizedMimeType = (mimeType || '').toLowerCase();
  return (
    !normalizedMimeType ||
    normalizedMimeType.includes('json') ||
    normalizedMimeType.includes('html') ||
    normalizedMimeType.includes('text/') ||
    normalizedMimeType.includes('javascript') ||
    normalizedMimeType.includes('x-component')
  );
};

const isRelevantResponse = (responseMeta: PendingResponseMeta): boolean => {
  const url = responseMeta.url;
  // Always allow specific important API endpoints regardless of mimeType
  if (
    url.includes('/backend-api/lat/') ||
    url.includes('/backend-api/sentinel/ping') ||
    url.includes('/backend-api/settings/user') ||
    url.includes('/backend-api/celsius/ws/user') ||
    url.includes('/backend-api/f/conversation')
  ) {
    return true;
  }

  if (!RELEVANT_HOST_PATTERNS.some((pattern) => url.includes(pattern))) {
    return false;
  }
  if (!isRelevantContentType(responseMeta.mimeType)) {
    return false;
  }
  return ['Document', 'Fetch', 'XHR', 'Other'].includes(
    responseMeta.resourceType || 'Other',
  );
};

export class ChatGptConversationNetworkMonitor {
  private static lastUserSettings: any = null;
  private static availableModels: string[] = [];

  private activeResumeRequestId: string | null = null;
  private lastSuccessfulBackendApiHeaders: CapturedBackendApiRequestHeaders | null = null;
  private latestWebSocketUrl: string | null = null;
  private sentinelHeaders: Record<string, string> = {};
  private readonly capturedUrls = new Set<string>();
  private readonly pendingRequests = new Map<string, PendingRequestMeta>();
  private readonly pendingResponses = new Map<string, PendingResponseMeta>();
  private readonly records: ChatGptConversationNetworkRecord[] = [];
  private readonly readyPromise: Promise<void>;

  public onResumeStreamFinished: (() => void) | null = null;

  constructor(private readonly webContents: WebContents) {
    this.readyPromise = this.attach();
    this.setupBackupMonitor();
  }

  async ready() {
    await this.readyPromise;
    // Trigger an initial fetch to populate the settings and models
    this.triggerInitialSettingsFetch();
  }

  private async triggerInitialSettingsFetch() {
    if (this.webContents.isDestroyed()) return;

    // Give some time for background requests to populate Auth headers
    await new Promise(r => setTimeout(r, 2000));

    const latestHeaders = this.getLatestBackendApiHeaders();
    const authHeader = latestHeaders?.headers?.['authorization'];

    // Inject a small script to trigger the fetch from the page context
    // Include Authorization header if available
    const targetUrl = `${BACKEND_API_PREFIX}settings/user`;
    const script = `
      (async () => {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (${JSON.stringify(authHeader)}) {
             headers['Authorization'] = ${JSON.stringify(authHeader)};
          }
          const res = await fetch('${targetUrl}', { headers });
          if (res.ok) {
             console.info('[gptviewer][initial-fetch] settings/user success');
          } else {
             console.warn('[gptviewer][initial-fetch] settings/user failed', res.status);
          }
        } catch (e) {
          // ignore network error if not on chatgpt.com domain yet
        }
      })();
    `;
    this.webContents.executeJavaScript(script).catch(() => {});
  }

  private setupBackupMonitor() {
    if (this.webContents.isDestroyed()) return;

    const session = this.webContents.session;
    const webContentsId = this.webContents.id;

    // Use an even broader filter to capture potentially missed domains
    const filter = { urls: ['<all_urls>'] };

    const recordUrl = (url: string, source: string) => {
        if (!url) return;
        const lowerUrl = url.toLowerCase();

        // Log all backend-api or specific patterns we are looking for
        if (lowerUrl.includes('/backend-api/') || lowerUrl.includes('lat/') || lowerUrl.includes('ping')) {
            if (!this.capturedUrls.has(url)) {
                this.capturedUrls.add(url);
                if (MONITOR_LOG_FLAGS.SHOW_BACKUP_REQUESTS) {
                    console.info(`[gptviewer][monitor:${source}] ${url}`);
                }
            }
        }
    };

    session.webRequest.onBeforeRequest(filter, (details, callback) => {
        if (details.webContentsId === webContentsId || details.url.includes('chatgpt.com')) {
            recordUrl(details.url, 'backup-request');
        }
        callback({});
    });

    session.webRequest.onHeadersReceived(filter, (details, callback) => {
        if (details.webContentsId === webContentsId || details.url.includes('chatgpt.com')) {
            recordUrl(details.url, 'backup-headers');
        }
        callback({ responseHeaders: details.responseHeaders });
    });

    session.webRequest.onResponseStarted(filter, (details) => {
        if (details.webContentsId === webContentsId || details.url.includes('chatgpt.com')) {
            recordUrl(details.url, 'backup-response');
        }
    });

    session.webRequest.onCompleted(filter, (details) => {
        if (details.webContentsId === webContentsId || details.url.includes('chatgpt.com')) {
            recordUrl(details.url, 'backup-completed');
        }
    });

    session.webRequest.onErrorOccurred(filter, (details) => {
        if (details.webContentsId === webContentsId || details.url.includes('chatgpt.com')) {
            recordUrl(details.url, 'backup-error');
        }
    });

    // Reliable Authorization header capture via session events
    session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        const url = details.url;
        if (details.webContentsId === webContentsId || url.includes('chatgpt.com')) {
            recordUrl(url, 'backup-send-headers');
            const normalized = normalizeHeaders(details.requestHeaders);
            if (normalized['authorization']) {
                if (!this.lastSuccessfulBackendApiHeaders || url.includes('/me') || url.includes('/models')) {
                    if (MONITOR_LOG_FLAGS.SHOW_AUTH_CAPTURE) {
                        console.info(`[gptviewer][monitor:backup-auth-captured] Authorization CAPTURED from ${url}`);
                    }
                    this.lastSuccessfulBackendApiHeaders = {
                        headers: sanitizeHeadersForReplay(normalized),
                        method: details.method.toUpperCase(),
                        statusCode: 0,
                        url: url,
                    };
                }
            }
        }
        callback({ requestHeaders: details.requestHeaders });
    });
  }

  clear() {
    this.lastSuccessfulBackendApiHeaders = null;
    this.sentinelHeaders = {};
    this.capturedUrls.clear();
    this.pendingRequests.clear();
    this.pendingResponses.clear();
    this.records.length = 0;
  }

  getRecords(): ChatGptConversationNetworkRecord[] {
    return [...this.records];
  }

  getAvailableModels(): string[] {
    return [...ChatGptConversationNetworkMonitor.availableModels];
  }

  getLatestModelConfig(): any {
    return ChatGptConversationNetworkMonitor.lastUserSettings?.settings?.last_used_model_config || null;
  }

  getLatestUserSettings(): any {
    return ChatGptConversationNetworkMonitor.lastUserSettings;
  }

  getLatestWebSocketUrl(): string | null {
    return this.latestWebSocketUrl;
  }

  isResumeStreamActive(): boolean {
    return this.activeResumeRequestId !== null;
  }

  static getStaticModelConfig(): any {
    return ChatGptConversationNetworkMonitor.lastUserSettings?.settings?.last_used_model_config || null;
  }

  hasCapturedUrl(pattern: string): boolean {
    const lowerPattern = pattern.toLowerCase();
    for (const url of this.capturedUrls) {
      if (url.toLowerCase().includes(lowerPattern)) {
        return true;
      }
    }
    return this.records.some((record) => record.url.toLowerCase().includes(lowerPattern));
  }

  getLatestBackendApiHeaders() {
    if (!this.lastSuccessfulBackendApiHeaders) return null;

    return {
      ...this.lastSuccessfulBackendApiHeaders,
      headers: {
        ...this.lastSuccessfulBackendApiHeaders.headers,
        ...this.sentinelHeaders
      }
    };
  }

  async dispose() {
    const debuggerApi = this.webContents.debugger;
    if (!debuggerApi.isAttached()) return;
    debuggerApi.removeListener('message', this.handleDebuggerMessage);
    try { await debuggerApi.detach(); } catch {}
  }

  private async attach() {
    if (this.webContents.isDestroyed()) return;
    const debuggerApi = this.webContents.debugger;
    try {
      if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
      debuggerApi.on('message', this.handleDebuggerMessage);
      await Promise.race([
        debuggerApi.sendCommand('Network.enable'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('debugger_timeout')), 5000))
      ]);
    } catch (error) {}
  }

  private mapSentinelTokens(url: string, payloadStr: string) {
    try {
      const payload = JSON.parse(payloadStr);
      if (!payload || typeof payload !== 'object') return;

      // 1. requirements-token (from prepare_token or token)
      const reqToken = payload.prepare_token || payload.token;
      if (reqToken) {
          this.sentinelHeaders['openai-sentinel-chat-requirements-token'] = reqToken;
          if (MONITOR_LOG_FLAGS.SHOW_MAPPING) {
              console.info(`[MAPPING] requirements-token captured from ${url}`);
          }
      }

      // 2. proof-token (from proofofwork or p or proof)
      const pToken = payload.proofofwork || payload.p || payload.proof;
      if (pToken) {
          this.sentinelHeaders['openai-sentinel-proof-token'] = pToken;
          if (MONITOR_LOG_FLAGS.SHOW_MAPPING) {
              console.info(`[MAPPING] proof-token captured from ${url}`);
          }
      }

      // 3. turnstile-token (from turnstile.token)
      if (payload.turnstile && typeof payload.turnstile === 'object' && payload.turnstile.token) {
          this.sentinelHeaders['openai-sentinel-turnstile-token'] = payload.turnstile.token;
          if (MONITOR_LOG_FLAGS.SHOW_MAPPING) {
              console.info(`[MAPPING] turnstile-token captured from ${url}`);
          }
      } else if (payload.turnstile && typeof payload.turnstile === 'string') {
          // fallback if it's direct string
          this.sentinelHeaders['openai-sentinel-turnstile-token'] = payload.turnstile;
          if (MONITOR_LOG_FLAGS.SHOW_MAPPING) {
              console.info(`[MAPPING] turnstile-token (string) captured from ${url}`);
          }
      }
    } catch (e) {}
  }

  private readonly handleDebuggerMessage = async (_event: Event, method: string, params: Record<string, unknown>) => {
    if (method === 'Network.responseReceived') {
      const response = params.response as { status?: number; url?: string; headers?: Record<string, string> } | undefined;
      const requestId = String(params.requestId || '');
      if (!requestId || !response?.url) return;

      const url = response.url;
      this.capturedUrls.add(url);

      if (url.includes('/backend-api/f/conversation/resume')) {
        this.activeResumeRequestId = requestId;
        if (MONITOR_LOG_FLAGS.SHOW_RESUME_STREAM) {
          console.info(`[gptviewer][monitor:resume] STREAM STARTED: ${url} (ID: ${requestId})`);
        }
      }

      if (!url.includes('/conversation/init')) {
        if (isTargetUrl(url) && MONITOR_LOG_FLAGS.SHOW_RESPONSE_HEADERS) {
          console.info(`Response Header (${url}): Status ${response.status}`, JSON.stringify(response.headers, null, 2));
        }
      }

      this.pendingResponses.set(requestId, {
        mimeType: (params.response as any).mimeType,
        resourceType: typeof params.type === 'string' ? params.type : undefined,
        status: typeof response.status === 'number' ? response.status : 0,
        url: response.url,
      });
    }

    if (method === 'Network.dataReceived') {
      const { requestId, dataLength } = params as { requestId: string; dataLength: number };
      if (requestId === this.activeResumeRequestId && MONITOR_LOG_FLAGS.SHOW_RESUME_STREAM) {
        console.info(`[gptviewer][monitor:resume] RECEIVING DATA: ${dataLength} bytes`);
      }
    }

    if (method === 'Network.requestWillBeSent') {
      const requestId = String(params.requestId || '');
      const request = params.request as { method?: string; url?: string; postData?: string; hasPostData?: boolean } | undefined;
      if (!requestId || !request?.url) return;

      const url = request.url;
      this.capturedUrls.add(url);

      // Log all backend-api requests for debugging lat/r detection
      if (url.includes('/backend-api/') && MONITOR_LOG_FLAGS.SHOW_GENERAL_REQUESTS) {
          console.info(`[gptviewer][monitor:request] ${url}`);
      }

      const existingRequestMeta = this.pendingRequests.get(requestId);
      this.pendingRequests.set(requestId, {
        headers: existingRequestMeta?.headers ?? {},
        method: String(request.method || existingRequestMeta?.method || 'GET').toUpperCase(),
        url: url,
      });

      if (!url.includes('/conversation/init')) {
        if (isTargetUrl(url)) {
          if (request.hasPostData && !request.postData) {
            const debuggerApi = this.webContents.debugger;
            if (debuggerApi.isAttached()) {
              debuggerApi.sendCommand('Network.getRequestPostData', { requestId })
                .then((res: any) => {
                  if (res?.postData) {
                    if (MONITOR_LOG_FLAGS.SHOW_REQUEST_BODY) {
                      console.info(`Request Body (${url}):`, res.postData);
                    }
                    if (url.includes('/finalize')) this.mapSentinelTokens(url, res.postData);
                  }
                }).catch(() => {});
            }
          } else if (request.postData) {
            if (MONITOR_LOG_FLAGS.SHOW_REQUEST_BODY) {
              console.info(`Request Body (${url}):`, request.postData);
            }
            if (url.includes('/finalize')) this.mapSentinelTokens(url, request.postData);
          }
        }
      }
    }

    if (method === 'Network.requestWillBeSentExtraInfo') {
      const requestId = String(params.requestId || '');
      const headers = params.headers as Record<string, string | string[]>;
      const existingRequestMeta = this.pendingRequests.get(requestId);
      const url = existingRequestMeta?.url || '';
      if (url) this.capturedUrls.add(url);
      const methodName = String(existingRequestMeta?.method || 'GET').toUpperCase();

      if (!requestId || !url) return;

      const normalized = normalizeHeaders(headers);
      this.pendingRequests.set(requestId, {
        headers: sanitizeHeadersForReplay(normalized),
        method: methodName,
        url: url,
      });

      if (!url.includes('/conversation/init')) {
        if (isTargetUrl(url)) {
          if (MONITOR_LOG_FLAGS.SHOW_REQUEST_HEADERS) {
            console.info(`Request Header (${url}):`, JSON.stringify(headers, null, 2));
          }
        }
      }

      if (url.startsWith(BACKEND_API_PREFIX)) {
        if (normalized['authorization']) {
          if (MONITOR_LOG_FLAGS.SHOW_AUTH_CAPTURE) {
            console.info(`[gptviewer][monitor] Authorization CAPTURED from ${url}`);
          }
          this.lastSuccessfulBackendApiHeaders = {
            headers: sanitizeHeadersForReplay(normalized),
            method: methodName,
            statusCode: 0,
            url: url,
          };
        } else if (!this.lastSuccessfulBackendApiHeaders) {
          this.lastSuccessfulBackendApiHeaders = {
            headers: sanitizeHeadersForReplay(normalized),
            method: methodName,
            statusCode: 0,
            url: url,
          };
        }
      }
    }

    if (method === 'Network.loadingFinished') {
      const requestId = String(params.requestId || '');
      const responseMeta = this.pendingResponses.get(requestId);
      if (responseMeta?.url) this.capturedUrls.add(responseMeta.url);
      const requestMeta = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);
      this.pendingResponses.delete(requestId);

      if (requestId === this.activeResumeRequestId) {
        this.activeResumeRequestId = null;
        if (MONITOR_LOG_FLAGS.SHOW_RESUME_STREAM) {
          console.info(`[gptviewer][monitor:resume] STREAM FINISHED. Triggering refresh...`);
        }
        if (this.onResumeStreamFinished) {
          this.onResumeStreamFinished();
        }
      }

      if (!requestId || !responseMeta || !isRelevantResponse(responseMeta)) return;

      if (requestMeta && responseMeta.url.startsWith(BACKEND_API_PREFIX) && requestMeta.method === 'GET' && responseMeta.status >= 200 && responseMeta.status < 300) {
        if (requestMeta.headers['authorization']) {
           this.lastSuccessfulBackendApiHeaders = { headers: requestMeta.headers, method: requestMeta.method, statusCode: responseMeta.status, url: responseMeta.url };
        }
      }

      const debuggerApi = this.webContents.debugger;
      if (!debuggerApi.isAttached()) return;

      try {
        const resBody = await debuggerApi.sendCommand('Network.getResponseBody', { requestId }) as { base64Encoded?: boolean; body?: string };
        if (typeof resBody.body !== 'string' || !resBody.body.trim()) return;
        const bodyText = resBody.base64Encoded ? Buffer.from(resBody.body, 'base64').toString('utf8') : resBody.body;

        const url = responseMeta.url;
        if (url.includes('/backend-api/settings/user')) {
            try {
                const payload = JSON.parse(bodyText);
                const modelConfig = payload?.settings?.last_used_model_config;
                const juices = modelConfig?.juices?.web || modelConfig?.juices?.default;

                if (juices && typeof juices === 'object') {
                    // Update cache ONLY when we have valid model data
                    ChatGptConversationNetworkMonitor.lastUserSettings = payload;
                    ChatGptConversationNetworkMonitor.availableModels = Object.keys(juices);
                    console.info(`[gptviewer][monitor:response] settings/user SUCCESS: Captured ${ChatGptConversationNetworkMonitor.availableModels.length} models.`);
                } else {
                    // If the payload is partial or doesn't have what we need, don't overwrite the static cache
                    console.warn(`[gptviewer][monitor:response] settings/user IGNORED: Valid model config not found. Keeping existing cache.`);
                }
            } catch (e) {
                console.error(`[gptviewer][monitor:response] settings/user ERROR parsing JSON:`, e);
            }
        }

        if (url.includes('/backend-api/celsius/ws/user')) {
            try {
                const payload = JSON.parse(bodyText);
                if (payload.wss_url) {
                    this.latestWebSocketUrl = payload.wss_url;
                }
            } catch (e) {}
            if (MONITOR_LOG_FLAGS.SHOW_WS_URL_CAPTURE) {
                console.info(`[gptviewer][monitor:response] /celsius/ws/user BODY:`, bodyText);
            }
        }

        if (!url.includes('/conversation/init')) {
          if (isTargetUrl(url)) {
            if (MONITOR_LOG_FLAGS.SHOW_RESPONSE_BODY) {
              console.info(`Response Body (${url}):`, bodyText);
            }

            // Extract tokens from Responses as reinforcement
            try {
                const payload = JSON.parse(bodyText);
                if (url.includes('/sentinel/chat-requirements/prepare') && payload.prepare_token) {
                    this.sentinelHeaders['openai-sentinel-chat-requirements-token'] = payload.prepare_token;
                    if (MONITOR_LOG_FLAGS.SHOW_MAPPING) {
                        console.info(`[MAPPING] requirements-token captured from Step 2 Response`);
                    }
                }
                if (url.includes('/sentinel/chat-requirements/finalize') && payload.token) {
                    this.sentinelHeaders['openai-sentinel-chat-requirements-token'] = payload.token;
                    if (MONITOR_LOG_FLAGS.SHOW_MAPPING) {
                        console.info(`[MAPPING] requirements-token captured from Step 3 Response`);
                    }
                }
            } catch(e) {}
          }
        }

        if (!bodyText.trim() || bodyText.length > MAX_BODY_LENGTH) return;
        this.records.push({ bodyText, mimeType: responseMeta.mimeType, resourceType: responseMeta.resourceType, status: responseMeta.status, url: responseMeta.url });
        if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
      } catch {}
    }

    if (method === 'Network.loadingFailed') {
      const requestId = String(params.requestId || '');
      const responseMeta = this.pendingResponses.get(requestId);
      if (responseMeta?.url) this.capturedUrls.add(responseMeta.url);
      this.pendingRequests.delete(requestId);
      this.pendingResponses.delete(requestId);
    }
  };
}
