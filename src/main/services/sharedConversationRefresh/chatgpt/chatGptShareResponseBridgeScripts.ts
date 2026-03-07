export type ChatGptShareNetworkEvent = {
  at: number;
  method: string;
  phase: 'body' | 'error' | 'request' | 'response';
  shareUrl?: string;
  status?: number;
  transport: 'fetch' | 'xhr';
  url: string;
};

const SHARE_URL_PATTERN = /https:\/\/chatgpt\.com\/share\/[\w-]+/i;
const BACKEND_SHARE_PATTERN = /\/backend-api\/share\/([\w-]+)/i;
const INVALID_SHARE_ID_PATTERN = /^(create|new)$/i;

export const buildInstallShareResponseBridgeScript = () => `
(() => {
  const bridgeKey = '__gptviewerShareResponseBridgeInstalled';
  const networkKey = '__gptviewerShareNetworkEvents';
  const valueKey = '__gptviewerLastShareUrlFromResponse';
  const sharePattern = /https:\\/\\/chatgpt\\.com\\/share\\/(?!(?:create|new)(?:[/?#]|$))[a-z0-9-]{16,}(?:[/?#].*)?/i;
  const backendSharePattern = /\\/backend-api\\/share\\/([\\w-]+)/i;
  const invalidShareIdPattern = /^(create|new)$/i;
  const pushNetworkEvent = (event) => {
    const events = Array.isArray(window[networkKey]) ? window[networkKey] : [];
    events.push({ at: Date.now(), ...event });
    if (events.length > 40) {
      events.splice(0, events.length - 40);
    }
    window[networkKey] = events;
  };
  const captureShareUrl = (value) => {
    if (typeof value !== 'string') return;
    const matchedShareUrl = value.match(sharePattern)?.[0];
    if (matchedShareUrl) {
      window[valueKey] = matchedShareUrl.trim();
      return matchedShareUrl.trim();
    }
    const backendShareId = value.match(backendSharePattern)?.[1];
    if (backendShareId && !invalidShareIdPattern.test(backendShareId) && backendShareId.length >= 16) {
      const resolvedShareUrl = 'https://chatgpt.com/share/' + backendShareId.trim();
      window[valueKey] = resolvedShareUrl;
      return resolvedShareUrl;
    }
    return '';
  };
  const patchFetch = () => {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const init = args[1] || {};
      const requestUrl = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : '');
      const requestMethod = String(
        init.method ||
        (input && typeof input.method === 'string' ? input.method : 'GET') ||
        'GET',
      ).toUpperCase();
      pushNetworkEvent({ method: requestMethod, phase: 'request', transport: 'fetch', url: requestUrl });
      const response = await originalFetch(...args);
      try {
        const responseUrl = response.url || requestUrl;
        const responseShareUrl = captureShareUrl(responseUrl);
        pushNetworkEvent({
          method: requestMethod,
          phase: 'response',
          shareUrl: responseShareUrl || undefined,
          status: response.status,
          transport: 'fetch',
          url: responseUrl,
        });
        const cloned = response.clone();
        void cloned.text().then((bodyText) => {
          const bodyShareUrl = captureShareUrl(bodyText);
          if (bodyShareUrl) {
            pushNetworkEvent({
              method: requestMethod,
              phase: 'body',
              shareUrl: bodyShareUrl,
              status: response.status,
              transport: 'fetch',
              url: responseUrl,
            });
          }
        }).catch(() => undefined);
      } catch {
        // Ignore response bridge failures.
      }
      return response;
    };
  };
  const patchXhr = () => {
    if (!window.XMLHttpRequest) return;
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(...args) {
      const method = String(args[0] || 'GET').toUpperCase();
      const url = typeof args[1] === 'string' ? args[1] : '';
      this.__gptviewerShareRequestInfo = { method, url };
      pushNetworkEvent({ method, phase: 'request', transport: 'xhr', url });
      this.addEventListener('loadend', () => {
        try {
          const requestInfo = this.__gptviewerShareRequestInfo || { method: 'GET', url };
          const responseUrl = this.responseURL || requestInfo.url || '';
          const responseShareUrl = captureShareUrl(responseUrl);
          pushNetworkEvent({
            method: requestInfo.method,
            phase: 'response',
            shareUrl: responseShareUrl || undefined,
            status: typeof this.status === 'number' ? this.status : 0,
            transport: 'xhr',
            url: responseUrl,
          });
          if (typeof this.responseText === 'string') {
            const bodyShareUrl = captureShareUrl(this.responseText);
            if (bodyShareUrl) {
              pushNetworkEvent({
                method: requestInfo.method,
                phase: 'body',
                shareUrl: bodyShareUrl,
                status: typeof this.status === 'number' ? this.status : 0,
                transport: 'xhr',
                url: responseUrl,
              });
            }
          }
        } catch {
          // Ignore response bridge failures.
        }
      });
      return originalOpen.apply(this, args);
    };
  };
  window[valueKey] = '';
  window[networkKey] = [];
  if (window[bridgeKey]) return true;
  patchFetch();
  patchXhr();
  window[bridgeKey] = true;
  return true;
})()
`;

export const buildReadShareResponseBridgeValueScript = () => `
(() => {
  const value = window.__gptviewerLastShareUrlFromResponse;
  return typeof value === 'string' ? value.trim() : '';
})()
`;

export const buildClearShareResponseBridgeValueScript = () => `
(() => {
  window.__gptviewerLastShareUrlFromResponse = '';
  return true;
})()
`;

export const buildReadShareNetworkEventsScript = () => `
(() => {
  const events = window.__gptviewerShareNetworkEvents;
  return Array.isArray(events) ? events.slice(-20) : [];
})()
`;

export const buildClearShareNetworkEventsScript = () => `
(() => {
  window.__gptviewerShareNetworkEvents = [];
  return true;
})()
`;

export const extractSuccessfulShareUpdateUrl = (
  events: ChatGptShareNetworkEvent[],
) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event.phase === 'response' &&
      event.status === 200 &&
      (event.method === 'PATCH' || event.method === 'POST') &&
      BACKEND_SHARE_PATTERN.test(event.url)
    ) {
      if (event.shareUrl && SHARE_URL_PATTERN.test(event.shareUrl)) {
        return event.shareUrl;
      }
      const shareId = event.url.match(BACKEND_SHARE_PATTERN)?.[1];
      if (shareId && !INVALID_SHARE_ID_PATTERN.test(shareId) && shareId.length >= 16) {
        return `https://chatgpt.com/share/${shareId}`;
      }
    }
  }
  return null;
};
