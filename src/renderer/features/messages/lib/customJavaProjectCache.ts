const CUSTOM_JAVA_PROJECT_CACHE_STORAGE_KEY =
  'gptviewer.custom-java-project-cache.v1';

const customJavaProjectCacheStore = new Map<string, Record<string, string>>();

let isCustomJavaProjectCacheLoaded = false;

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const ensureCustomJavaProjectCacheLoaded = () => {
  if (isCustomJavaProjectCacheLoaded || typeof window === 'undefined') return;
  isCustomJavaProjectCacheLoaded = true;

  try {
    const rawValue = window.localStorage.getItem(CUSTOM_JAVA_PROJECT_CACHE_STORAGE_KEY);
    if (!rawValue) return;

    const parsedValue = JSON.parse(rawValue) as Record<string, Record<string, string>>;
    Object.entries(parsedValue).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        customJavaProjectCacheStore.set(key, value as Record<string, string>);
      }
    });
  } catch {
    // Ignore localStorage failures
  }
};

const persistCustomJavaProjectCache = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CUSTOM_JAVA_PROJECT_CACHE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(customJavaProjectCacheStore.entries())),
    );
  } catch {
    // Ignore localStorage failures
  }
};

export const buildCustomJavaProjectCacheKey = (
  scope: string | undefined,
  source: string,
) => {
  const normalizedScope = (scope || '').trim();
  const normalizedSource = source.replace(/\r\n/g, '\n');

  if (!normalizedScope || !normalizedSource) {
    return '';
  }

  return `proj::${normalizedScope}:${hashString(normalizedSource)}`;
};

export const loadCustomJavaProjectFromCache = (cacheKey: string): Record<string, string> | null => {
  if (!cacheKey) return null;
  ensureCustomJavaProjectCacheLoaded();
  return customJavaProjectCacheStore.get(cacheKey) || null;
};

export const saveCustomJavaProjectToCache = (
  cacheKey: string,
  snapshot: Record<string, string>,
) => {
  if (!cacheKey || !snapshot) return;
  ensureCustomJavaProjectCacheLoaded();
  customJavaProjectCacheStore.set(cacheKey, snapshot);
  persistCustomJavaProjectCache();
};

export const clearCustomJavaProjectFromCache = (cacheKey: string) => {
  if (!cacheKey) return;
  ensureCustomJavaProjectCacheLoaded();
  customJavaProjectCacheStore.delete(cacheKey);
  persistCustomJavaProjectCache();
};

export const clearAllCustomJavaProjectCache = () => {
  ensureCustomJavaProjectCacheLoaded();
  customJavaProjectCacheStore.clear();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CUSTOM_JAVA_PROJECT_CACHE_STORAGE_KEY);
  } catch {}
};
