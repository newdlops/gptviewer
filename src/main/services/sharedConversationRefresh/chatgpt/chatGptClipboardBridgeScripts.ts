export const buildInstallClipboardBridgeScript = () => `
(() => {
  const bridgeKey = '__gptviewerClipboardBridgeInstalled';
  const valueKey = '__gptviewerLastClipboardWriteText';
  const patchWriteText = (target, original) => {
    if (!target || typeof original !== 'function') return false;
    try {
      Object.defineProperty(target, 'writeText', {
        configurable: true,
        value: async (value) => {
          const text = typeof value === 'string' ? value : String(value ?? '');
          window[valueKey] = text;
          try {
            await original(text);
          } catch {
            return;
          }
        },
      });
      return true;
    } catch {
      return false;
    }
  };
  window[valueKey] = '';
  if (window[bridgeKey]) {
    return true;
  }
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    window[bridgeKey] = true;
    return true;
  }
  const originalWriteText = clipboard.writeText.bind(clipboard);
  const patched =
    patchWriteText(clipboard, originalWriteText) ||
    patchWriteText(Object.getPrototypeOf(clipboard), originalWriteText);
  window[bridgeKey] = patched;
  return patched;
})()
`;

export const buildReadClipboardBridgeValueScript = () => `
(() => {
  const value = window.__gptviewerLastClipboardWriteText;
  return typeof value === 'string' ? value.trim() : '';
})()
`;

export const buildClearClipboardBridgeValueScript = () => `
(() => {
  window.__gptviewerLastClipboardWriteText = '';
  return true;
})()
`;
