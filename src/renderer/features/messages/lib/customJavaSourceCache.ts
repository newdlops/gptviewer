const CUSTOM_JAVA_SOURCE_CACHE_STORAGE_KEY =
  'gptviewer.custom-java-source-cache.v1';

const customJavaSourceCacheStore = new Map<string, string>();

let isCustomJavaSourceCacheLoaded = false;

const normalizeCachedSource = (value: string) =>
  value.replace(/\r\n/g, '\n'); // trim() 제거

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

const ensureCustomJavaSourceCacheLoaded = () => {
  if (isCustomJavaSourceCacheLoaded || typeof window === 'undefined') {
    return;
  }

  isCustomJavaSourceCacheLoaded = true;

  try {
    const rawValue = window.localStorage.getItem(
      CUSTOM_JAVA_SOURCE_CACHE_STORAGE_KEY,
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
        customJavaSourceCacheStore.set(key, normalizedValue);
      }
    });
  } catch {
    // Ignore localStorage failures and continue with the in-memory store only.
  }
};

const persistCustomJavaSourceCache = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      CUSTOM_JAVA_SOURCE_CACHE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(customJavaSourceCacheStore.entries())),
    );
  } catch {
    // Ignore localStorage failures and continue with the in-memory store only.
  }
};

export const buildCustomJavaSourceCacheKey = (
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

export const loadCustomJavaSourceFromCache = (cacheKey: string) => {
  if (!cacheKey) {
    return '';
  }

  ensureCustomJavaSourceCacheLoaded();
  return customJavaSourceCacheStore.get(cacheKey) ?? '';
};

export const saveCustomJavaSourceToCache = (
  cacheKey: string,
  source: string,
) => {
  const normalizedSource = normalizeCachedSource(source);

  if (!cacheKey || !normalizedSource) {
    return;
  }

  ensureCustomJavaSourceCacheLoaded();
  customJavaSourceCacheStore.set(cacheKey, normalizedSource);
  persistCustomJavaSourceCache();
};

export const clearCustomJavaSourceFromCache = (cacheKey: string) => {
  if (!cacheKey) {
    return;
  }

  ensureCustomJavaSourceCacheLoaded();
  customJavaSourceCacheStore.delete(cacheKey);
  persistCustomJavaSourceCache();
};

export const clearAllCustomJavaSourceCache = () => {
  ensureCustomJavaSourceCacheLoaded();
  customJavaSourceCacheStore.clear();

  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(CUSTOM_JAVA_SOURCE_CACHE_STORAGE_KEY);
  } catch {
    // Ignore localStorage failures and continue with the in-memory store only.
  }
};
