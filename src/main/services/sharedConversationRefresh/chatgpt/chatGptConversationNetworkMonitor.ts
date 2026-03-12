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
    this.pendingRequests.clear();
    this.pendingResponses.clear();
    this.records.length = 0;
  }

  getRecords(): ChatGptConversationNetworkRecord[] {
    return [...this.records];
  }

  getLatestBackendApiHeaders() {
    return this.lastSuccessfulBackendApiHeaders;
  }

  async dispose() {
    const debuggerApi = this.webContents.debugger;

    if (!debuggerApi.isAttached()) {
      return;
    }

    debuggerApi.removeListener('message', this.handleDebuggerMessage);

    try {
      await debuggerApi.detach();
    } catch {
      // Ignore detach failures.
    }
  }

  private async attach() {
    if (this.webContents.isDestroyed()) {
      return;
    }

    const debuggerApi = this.webContents.debugger;

    try {
      if (!debuggerApi.isAttached()) {
        console.info('[gptviewer][network-monitor] attaching debugger...');
        debuggerApi.attach('1.3');
      }

      debuggerApi.on('message', this.handleDebuggerMessage);

      console.info('[gptviewer][network-monitor] enabling network domain...');
      // 5초 타임아웃 추가
      await Promise.race([
        debuggerApi.sendCommand('Network.enable'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('debugger_command_timeout')), 5000))
      ]);
      console.info('[gptviewer][network-monitor] debugger attached and network enabled.');
    } catch (error) {
      console.warn(`[gptviewer][network-monitor] debugger attach failed: ${error instanceof Error ? error.message : 'unknown'}`);
      // Ignore debugger attach failures and allow DOM fallback to continue.
    }
  }

  private readonly handleDebuggerMessage = async (
    _event: Event,
    method: string,
    params: Record<string, unknown>,
  ) => {
    if (method === 'Network.responseReceived') {
      const response = params.response as
        | {
            mimeType?: string;
            status?: number;
            url?: string;
            headers?: Record<string, string>;
          }
        | undefined;
      const requestId = String(params.requestId || '');

      if (!requestId || !response?.url) {
        return;
      }

      // --- Sentinel Flow Response Logging ---
      const isSentinel = response.url.includes('/sentinel/chat-requirements');
      const isConversation = response.url.includes('/backend-api/conversation');
      if (isSentinel || isConversation) {
          const typeLabel = response.url.includes('/finalize') ? 'FINALIZE' : (isSentinel ? 'PREPARE' : 'CONVERSATION');
          console.info(`[gptviewer][sentinel-flow][${typeLabel}] Response Status: ${response.status}`);
          console.info(`[gptviewer][sentinel-flow][${typeLabel}] Response Headers:`, JSON.stringify(response.headers, null, 2));
      }

      this.pendingResponses.set(requestId, {
        mimeType: response.mimeType,
        resourceType:
          typeof params.type === 'string' ? params.type : undefined,
        status:
          typeof response.status === 'number' ? response.status : 0,
        url: response.url,
      });
      return;
    }

    if (method === 'Network.requestWillBeSent') {
      const requestId = String(params.requestId || '');
      const request =
        params.request && typeof params.request === 'object'
          ? (params.request as { method?: string; url?: string; postData?: string })
          : undefined;

      if (!requestId || !request?.url) {
        return;
      }

      const existingRequestMeta = this.pendingRequests.get(requestId);
      this.pendingRequests.set(requestId, {
        headers: existingRequestMeta?.headers ?? {},
        method: String(request.method || existingRequestMeta?.method || 'GET').toUpperCase(),
        url: request.url,
      });

      // --- Sentinel Flow Logging & Mapping ---
      const isSentinel = request.url.includes('/sentinel/chat-requirements');
      const isFinalize = request.url.includes('/finalize');
      const isConversation = request.url.includes('/backend-api/conversation') && request.method === 'POST';

      if (isSentinel || isConversation) {
        const typeLabel = isFinalize ? 'FINALIZE' : (isSentinel ? 'PREPARE' : 'CONVERSATION');
        try {
          const payload = request.postData ? JSON.parse(request.postData) : null;
          console.info(`[gptviewer][sentinel-flow][${typeLabel}] Request URL: ${request.url}`);
          if (payload) {
             console.info(`[gptviewer][sentinel-flow][${typeLabel}] Payload:`, JSON.stringify(payload, null, 2));
          }

          // Finalize 단계에서 토큰 추출 및 헤더 매핑 (Conversation 요청 준비)
          if (isFinalize && payload && typeof payload === 'object') {
            if (!this.lastSuccessfulBackendApiHeaders) {
               this.lastSuccessfulBackendApiHeaders = { headers: {}, method: 'POST', statusCode: 0, url: '' };
            }

            // Mapping: prepare_token (or token) -> openai-sentinel-chat-requirements-token
            const requirementsToken = payload.prepare_token || payload.token;
            if (requirementsToken) {
               this.lastSuccessfulBackendApiHeaders.headers['openai-sentinel-chat-requirements-token'] = requirementsToken;
            }

            // Mapping: proofofwork (or p, proof) -> openai-sentinel-proof-token
            const proofToken = payload.proofofwork || payload.p || payload.proof;
            if (proofToken) {
               this.lastSuccessfulBackendApiHeaders.headers['openai-sentinel-proof-token'] = proofToken;
            }

            // Mapping: turnstile -> openai-sentinel-turnstile-token
            if (payload.turnstile && payload.turnstile.token) {
               this.lastSuccessfulBackendApiHeaders.headers['openai-sentinel-turnstile-token'] = payload.turnstile.token;
            }

            console.info('[gptviewer][sentinel-flow][MAPPING] Sentinel headers mapped for next conversation.');
          }
        } catch (e) {
          console.warn(`[gptviewer][sentinel-flow][${typeLabel}] Failed to parse payload`, e);
        }
      }

      return;
    }

    if (method === 'Network.requestWillBeSentExtraInfo') {
      const requestId = String(params.requestId || '');
      const headers =
        params.headers && typeof params.headers === 'object'
          ? (params.headers as Record<string, string | string[]>)
          : {};
      const existingRequestMeta = this.pendingRequests.get(requestId);
      const methodName = String(
        (params as { headersText?: string; method?: string }).method ||
          existingRequestMeta?.method ||
          'GET',
      ).toUpperCase();

      const requestUrl =
        existingRequestMeta?.url ||
        String((params as { url?: string }).url || '');

      if (!requestId || !requestUrl) {
        return;
      }

      this.pendingRequests.set(requestId, {
        headers: sanitizeHeadersForReplay(normalizeHeaders(headers)),
        method: methodName,
        url: requestUrl,
      });

      // --- Sentinel Flow Headers Logging ---
      const isSentinel = requestUrl.includes('/sentinel/chat-requirements');
      const isConversation = requestUrl.includes('/backend-api/conversation') && methodName === 'POST';
      if (isSentinel || isConversation) {
          const typeLabel = requestUrl.includes('/finalize') ? 'FINALIZE' : (isSentinel ? 'PREPARE' : 'CONVERSATION');
          console.info(`[gptviewer][sentinel-flow][${typeLabel}] Request Headers:`, JSON.stringify(headers, null, 2));
      }

      if (
        requestUrl.startsWith(BACKEND_API_PREFIX) &&
        (methodName === 'GET' || methodName === 'POST')
      ) {
        const normalized = normalizeHeaders(headers);

        // We only want to capture headers if they contain the vital auth/sentinel info.
        // Once we have a good set, we only replace it if the new one is also "rich".
        const isRichHeader = !!normalized['authorization'] || !!normalized['openai-sentinel-chat-requirements-token'];

        if (isRichHeader || !this.lastSuccessfulBackendApiHeaders) {
            this.lastSuccessfulBackendApiHeaders = {
              headers: sanitizeHeadersForReplay(normalized),
              method: methodName,
              statusCode: 0,
              url: requestUrl,
            };
        }
      }

      return;
    }

    if (method === 'Network.loadingFailed') {
      this.pendingRequests.delete(String(params.requestId || ''));
      this.pendingResponses.delete(String(params.requestId || ''));
      return;
    }

    if (method !== 'Network.loadingFinished') {
      return;
    }

    const requestId = String(params.requestId || '');
    const responseMeta = this.pendingResponses.get(requestId);
    const requestMeta = this.pendingRequests.get(requestId);
    this.pendingRequests.delete(requestId);
    this.pendingResponses.delete(requestId);

    if (!requestId || !responseMeta || !isRelevantResponse(responseMeta)) {
      return;
    }

    if (
      requestMeta &&
      responseMeta.url.startsWith(BACKEND_API_PREFIX) &&
      requestMeta.method === 'GET' &&
      responseMeta.status >= 200 &&
      responseMeta.status < 300
    ) {
      this.lastSuccessfulBackendApiHeaders = {
        headers: requestMeta.headers,
        method: requestMeta.method,
        statusCode: responseMeta.status,
        url: responseMeta.url,
      };
    }

    const debuggerApi = this.webContents.debugger;

    if (!debuggerApi.isAttached()) {
      return;
    }

    try {
      const responseBody = (await debuggerApi.sendCommand(
        'Network.getResponseBody',
        { requestId },
      )) as { base64Encoded?: boolean; body?: string };

      if (typeof responseBody.body !== 'string' || !responseBody.body.trim()) {
        return;
      }

      const bodyText = responseBody.base64Encoded
        ? Buffer.from(responseBody.body, 'base64').toString('utf8')
        : responseBody.body;

      if (!bodyText.trim() || bodyText.length > MAX_BODY_LENGTH) {
        return;
      }

      this.records.push({
        bodyText,
        mimeType: responseMeta.mimeType,
        resourceType: responseMeta.resourceType,
        status: responseMeta.status,
        url: responseMeta.url,
      });

      if (this.records.length > MAX_RECORDS) {
        this.records.splice(0, this.records.length - MAX_RECORDS);
      }
    } catch {
      // Ignore response body failures and continue.
    }
  };
}
