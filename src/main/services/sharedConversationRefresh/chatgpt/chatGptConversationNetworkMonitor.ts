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
  // Allow all oai-* and openai-* headers. Block only standard browser-managed headers.
  const blockedHeaderPattern =
    /^(host|connection|content-length|origin|referer|accept-encoding|priority|sec-fetch-.*|sec-ch-.*)$/i;

  Object.entries(headers).forEach(([key, value]) => {
    // Note: We keep cookies because they are handled by the browser fetch automatically,
    // but some fetch implementations might conflict if 'cookie' is manually set.
    // Usually it's safer to let the browser handle cookies and just pass the Authorization and custom headers.
    if (!value || blockedHeaderPattern.test(key) || key.startsWith(':') || key.toLowerCase() === 'cookie') {
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
  if (!RELEVANT_HOST_PATTERNS.some((pattern) => responseMeta.url.includes(pattern))) {
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
  private lastSuccessfulBackendApiHeaders: CapturedBackendApiRequestHeaders | null = null;
  private sentinelHeaders: Record<string, string> = {};
  private readonly pendingRequests = new Map<string, PendingRequestMeta>();
  private readonly pendingResponses = new Map<string, PendingResponseMeta>();
  private readonly records: ChatGptConversationNetworkRecord[] = [];
  private readonly readyPromise: Promise<void>;

  constructor(private readonly webContents: WebContents) {
    this.readyPromise = this.attach();
  }

  async ready() {
    await this.readyPromise;
  }

  clear() {
    this.lastSuccessfulBackendApiHeaders = null;
    this.sentinelHeaders = {};
    this.pendingRequests.clear();
    this.pendingResponses.clear();
    this.records.length = 0;
  }

  getRecords(): ChatGptConversationNetworkRecord[] {
    return [...this.records];
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

  private readonly handleDebuggerMessage = async (_event: Event, method: string, params: Record<string, unknown>) => {
    if (method === 'Network.responseReceived') {
      const response = params.response as { status?: number; url?: string; headers?: Record<string, string> } | undefined;
      const requestId = String(params.requestId || '');
      if (!requestId || !response?.url) return;

      const url = response.url;
      if (!url.includes('/conversation/init')) {
        const isSentinel = url.includes('/sentinel/chat-requirements');
        const isConversation = url.includes('/backend-api/f/conversation');
        if (isSentinel || isConversation) {
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

    if (method === 'Network.requestWillBeSent') {
      const requestId = String(params.requestId || '');
      const request = params.request as { method?: string; url?: string; postData?: string; hasPostData?: boolean } | undefined;
      if (!requestId || !request?.url) return;

      const url = request.url;
      const existingRequestMeta = this.pendingRequests.get(requestId);
      this.pendingRequests.set(requestId, {
        headers: existingRequestMeta?.headers ?? {},
        method: String(request.method || existingRequestMeta?.method || 'GET').toUpperCase(),
        url: url,
      });

      if (!url.includes('/conversation/init')) {
        const isSentinel = url.includes('/sentinel/chat-requirements');
        const isConversation = url.includes('/backend-api/f/conversation');
        if (isSentinel || isConversation) {
          // Log Request Body even if it's empty to show the flow
          let bodyToLog = request.postData || '';
          
          if (request.hasPostData && !bodyToLog) {
              // Try to fetch it via debugger if not provided initially
              const debuggerApi = this.webContents.debugger;
              if (debuggerApi.isAttached()) {
                  debuggerApi.sendCommand('Network.getRequestPostData', { requestId })
                      .then((res: any) => {
                          if (res?.postData) {
                              console.info(`Request Body (${url}):`, res.postData);
                          }
                      })
                      .catch(() => {});
              }
          }

          if (bodyToLog) {
            try {
              const payload = JSON.parse(bodyToLog);
              console.info(`Request Body (${url}):`, JSON.stringify(payload, null, 2));

              // Step 3 (Finalize) Payload Mapping
              if (url.includes('/sentinel/chat-requirements/finalize')) {
                const reqToken = payload.prepare_token || payload.token;
                if (reqToken) this.sentinelHeaders['openai-sentinel-chat-requirements-token'] = reqToken;
                const pToken = payload.proofofwork || payload.p || payload.proof;
                if (pToken) this.sentinelHeaders['openai-sentinel-proof-token'] = pToken;
                if (payload.turnstile?.token) this.sentinelHeaders['openai-sentinel-turnstile-token'] = payload.turnstile.token;
                console.info(`[MAPPING] Sentinel tokens mapped from ${url}`);
              }
            } catch (e) {
              console.info(`Request Body (${url}):`, bodyToLog);
            }
          }
        }
      }
    }

    if (method === 'Network.requestWillBeSentExtraInfo') {
      const requestId = String(params.requestId || '');
      const headers = params.headers as Record<string, string | string[]>;
      const existingRequestMeta = this.pendingRequests.get(requestId);
      const url = existingRequestMeta?.url || '';
      const methodName = String(existingRequestMeta?.method || 'GET').toUpperCase();

      if (!requestId || !url) return;

      this.pendingRequests.set(requestId, {
        headers: sanitizeHeadersForReplay(normalizeHeaders(headers)),
        method: methodName,
        url: url,
      });

      if (!url.includes('/conversation/init')) {
        const isSentinel = url.includes('/sentinel/chat-requirements');
        const isConversation = url.includes('/backend-api/f/conversation');
        if (isSentinel || isConversation) {
          console.info(`Request Header (${url}):`, JSON.stringify(headers, null, 2));
        }
      }

      if (url.startsWith(BACKEND_API_PREFIX) && (methodName === 'GET' || methodName === 'POST')) {
        const normalized = normalizeHeaders(headers);
        const hasAuth = !!normalized['authorization'];
        
        if (hasAuth) {
            console.info(`[gptviewer][monitor] Authorization header CAPTURED from ${url}`);
        }

        // Always update if new headers have Authorization, or if we have nothing yet.
        if (hasAuth || !this.lastSuccessfulBackendApiHeaders) {
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
      const requestMeta = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);
      this.pendingResponses.delete(requestId);

      if (!requestId || !responseMeta || !isRelevantResponse(responseMeta)) return;

      if (requestMeta && responseMeta.url.startsWith(BACKEND_API_PREFIX) && requestMeta.method === 'GET' && responseMeta.status >= 200 && responseMeta.status < 300) {
        this.lastSuccessfulBackendApiHeaders = { headers: requestMeta.headers, method: requestMeta.method, statusCode: responseMeta.status, url: responseMeta.url };
      }

      const debuggerApi = this.webContents.debugger;
      if (!debuggerApi.isAttached()) return;

      try {
        const resBody = await debuggerApi.sendCommand('Network.getResponseBody', { requestId }) as { base64Encoded?: boolean; body?: string };
        if (typeof resBody.body !== 'string' || !resBody.body.trim()) return;
        const bodyText = resBody.base64Encoded ? Buffer.from(resBody.body, 'base64').toString('utf8') : resBody.body;

        const url = responseMeta.url;
        if (!url.includes('/conversation/init')) {
          const isSentinel = url.includes('/sentinel/chat-requirements');
          const isConversation = url.includes('/backend-api/f/conversation');
          if (isSentinel || isConversation) {
            console.info(`Response Body (${url}):`, bodyText);
          }
        }

        if (!bodyText.trim() || bodyText.length > MAX_BODY_LENGTH) return;
        this.records.push({ bodyText, mimeType: responseMeta.mimeType, resourceType: responseMeta.resourceType, status: responseMeta.status, url: responseMeta.url });
        if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
      } catch {}
    }

    if (method === 'Network.loadingFailed') {
      this.pendingRequests.delete(String(params.requestId || ''));
      this.pendingResponses.delete(String(params.requestId || ''));
    }
  };
}
