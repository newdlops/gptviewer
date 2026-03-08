export type ProjectImportNetworkState = {
  inFlight: number;
  lastActivityAt: number;
  lastRequestAt: number;
  lastResponseAt: number;
};

export const buildInstallProjectImportNetworkMonitorScript = () => `
(() => {
  const bridgeKey = '__gptviewerProjectImportNetworkMonitorInstalled';
  const stateKey = '__gptviewerProjectImportNetworkState';
  const now = () => Date.now();
  const ensureState = () => {
    const current = window[stateKey];
    if (current && typeof current === 'object') {
      return current;
    }
    const next = { inFlight: 0, lastActivityAt: now(), lastRequestAt: 0, lastResponseAt: 0 };
    window[stateKey] = next;
    return next;
  };
  const markRequest = () => {
    const state = ensureState();
    state.inFlight += 1;
    state.lastRequestAt = now();
    state.lastActivityAt = state.lastRequestAt;
  };
  const markResponse = () => {
    const state = ensureState();
    state.inFlight = Math.max(0, state.inFlight - 1);
    state.lastResponseAt = now();
    state.lastActivityAt = state.lastResponseAt;
  };
  const markError = () => {
    const state = ensureState();
    state.inFlight = Math.max(0, state.inFlight - 1);
    state.lastActivityAt = now();
  };
  if (window[bridgeKey]) {
    ensureState();
    return true;
  }
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      markRequest();
      try {
        const response = await originalFetch(...args);
        markResponse();
        return response;
      } catch (error) {
        markError();
        throw error;
      }
    };
  }
  if (window.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(...args) {
      this.__gptviewerProjectImportMonitored = true;
      return originalOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.send = function patchedSend(...args) {
      if (this.__gptviewerProjectImportMonitored) {
        markRequest();
        this.addEventListener('loadend', markResponse, { once: true });
        this.addEventListener('error', markError, { once: true });
        this.addEventListener('abort', markError, { once: true });
      }
      return originalSend.apply(this, args);
    };
  }
  ensureState();
  window[bridgeKey] = true;
  return true;
})()
`;

export const buildReadProjectImportNetworkStateScript = () => `
(() => {
  const state = window.__gptviewerProjectImportNetworkState;
  if (!state || typeof state !== 'object') {
    return { inFlight: 0, lastActivityAt: 0, lastRequestAt: 0, lastResponseAt: 0 };
  }
  return {
    inFlight: Number.isFinite(state.inFlight) ? state.inFlight : 0,
    lastActivityAt: Number.isFinite(state.lastActivityAt) ? state.lastActivityAt : 0,
    lastRequestAt: Number.isFinite(state.lastRequestAt) ? state.lastRequestAt : 0,
    lastResponseAt: Number.isFinite(state.lastResponseAt) ? state.lastResponseAt : 0,
  };
})()
`;

