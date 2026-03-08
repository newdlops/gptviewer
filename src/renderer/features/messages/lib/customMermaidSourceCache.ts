const CUSTOM_MERMAID_SOURCE_CACHE_STORAGE_KEY =
  'gptviewer.custom-mermaid-source-cache.v1';

const customMermaidSourceCacheStore = new Map<string, string>();

let isCustomMermaidSourceCacheLoaded = false;

const normalizeCachedSource = (value: string) =>
  value.replace(/\r\n/g, '\n').replace(/\n$/, '').trim();

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

const ensureCustomMermaidSourceCacheLoaded = () => {
  if (isCustomMermaidSourceCacheLoaded || typeof window === 'undefined') {
    return;
  }

  isCustomMermaidSourceCacheLoaded = true;

  try {
    const rawValue = window.localStorage.getItem(
      CUSTOM_MERMAID_SOURCE_CACHE_STORAGE_KEY,
    );

    if (!rawValue) {
      return;
    }

    const parsedValue = JSON.parse(rawValue) as Record<string, unknown>;

    Object.entries(parsedValue).forEach(([key, value]) => {
      if (typeof value !== 'string') {
        return;
      }

      const normalizedValue = normalizeCachedSource(value);

      if (normalizedValue) {
        customMermaidSourceCacheStore.set(key, normalizedValue);
      }
    });
  } catch {
    // Ignore localStorage failures and continue with the in-memory store only.
  }
};

const persistCustomMermaidSourceCache = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      CUSTOM_MERMAID_SOURCE_CACHE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(customMermaidSourceCacheStore.entries())),
    );
  } catch {
    // Ignore localStorage failures and continue with the in-memory store only.
  }
};

export const buildCustomMermaidSourceCacheKey = (
  scope: string | undefined,
  source: string,
) => {
  const normalizedScope = (scope || '').trim();
  const normalizedSource = normalizeCachedSource(source);

  if (!normalizedScope || !normalizedSource) {
    return '';
  }

  return `${normalizedScope}:${hashString(normalizedSource)}`;
};

export const loadCustomMermaidSourceFromCache = (cacheKey: string) => {
  if (!cacheKey) {
    return '';
  }

  ensureCustomMermaidSourceCacheLoaded();
  return customMermaidSourceCacheStore.get(cacheKey) ?? '';
};

export const saveCustomMermaidSourceToCache = (
  cacheKey: string,
  source: string,
) => {
  const normalizedSource = normalizeCachedSource(source);

  if (!cacheKey || !normalizedSource) {
    return;
  }

  ensureCustomMermaidSourceCacheLoaded();
  customMermaidSourceCacheStore.set(cacheKey, normalizedSource);
  persistCustomMermaidSourceCache();
};

export const clearCustomMermaidSourceFromCache = (cacheKey: string) => {
  if (!cacheKey) {
    return;
  }

  ensureCustomMermaidSourceCacheLoaded();
  customMermaidSourceCacheStore.delete(cacheKey);
  persistCustomMermaidSourceCache();
};
