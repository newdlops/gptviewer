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
    /^(cookie|host|connection|content-length|origin|referer|user-agent|accept-encoding|priority|sec-fetch-.*|sec-ch-.*)$/i;

  Object.entries(headers).forEach(([key, value]) => {
    if (!value || blockedHeaderPattern.test(key) || key.startsWith(':')) {
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
  if (!responseMeta.url.includes('chatgpt.com')) {
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
        debuggerApi.attach('1.3');
      }
      debuggerApi.on('message', this.handleDebuggerMessage);
      await debuggerApi.sendCommand('Network.enable');
    } catch {
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
          }
        | undefined;
      const requestId = String(params.requestId || '');

      if (!requestId || !response?.url) {
        return;
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
          ? (params.request as { method?: string; url?: string })
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
      return;
    }

    if (method === 'Network.requestWillBeSentExtraInfo') {
      const requestId = String(params.requestId || '');
      const associatedCookies = Array.isArray(params.associatedCookies)
        ? params.associatedCookies
        : [];
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

      if (
        requestUrl.startsWith(BACKEND_API_PREFIX) &&
        methodName === 'GET' &&
        associatedCookies.length > 0
      ) {
        this.lastSuccessfulBackendApiHeaders = {
          headers: sanitizeHeadersForReplay(normalizeHeaders(headers)),
          method: methodName,
          statusCode: 0,
          url: requestUrl,
        };
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
