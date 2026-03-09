import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export type ChatGptImageAssetCacheEntry = {
  cacheKey: string;
  dataUrl: string;
  sourceUrl: string;
};

type PersistedCacheRecord = ChatGptImageAssetCacheEntry & {
  updatedAt: string;
};

const CACHE_DIRECTORY_NAME = 'chatgpt-image-cache';
const MAX_DISK_CACHE_FILES = 1200;
const CLEANUP_WRITE_INTERVAL = 40;

const isValidCacheEntry = (
  value: unknown,
): value is ChatGptImageAssetCacheEntry => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.cacheKey === 'string' &&
    record.cacheKey.trim().length > 0 &&
    typeof record.sourceUrl === 'string' &&
    record.sourceUrl.trim().length > 0 &&
    typeof record.dataUrl === 'string' &&
    record.dataUrl.startsWith('data:image/')
  );
};

export class ChatGptImageAssetDiskCache {
  private cacheDirectoryPath = '';
  private cleanupPromise: Promise<void> | null = null;
  private initializationPromise: Promise<void> | null = null;
  private writeCount = 0;

  private async ensureInitialized() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      const userDataPath = app.getPath('userData');
      this.cacheDirectoryPath = join(userDataPath, CACHE_DIRECTORY_NAME);
      await fs.mkdir(this.cacheDirectoryPath, { recursive: true });
    })();

    return this.initializationPromise;
  }

  private getFilePathForKey(cacheKey: string) {
    const digest = createHash('sha1').update(cacheKey).digest('hex');
    return join(this.cacheDirectoryPath, `${digest}.json`);
  }

  async get(cacheKey: string): Promise<ChatGptImageAssetCacheEntry | null> {
    if (!cacheKey.trim()) {
      return null;
    }

    try {
      await this.ensureInitialized();
      const filePath = this.getFilePathForKey(cacheKey);
      const rawValue = await fs.readFile(filePath, 'utf8');
      const parsedValue = JSON.parse(rawValue) as unknown;
      if (!isValidCacheEntry(parsedValue)) {
        return null;
      }

      if (parsedValue.cacheKey !== cacheKey) {
        return null;
      }

      return parsedValue;
    } catch {
      return null;
    }
  }

  async set(entry: ChatGptImageAssetCacheEntry): Promise<void> {
    if (!isValidCacheEntry(entry)) {
      return;
    }

    try {
      await this.ensureInitialized();
      const filePath = this.getFilePathForKey(entry.cacheKey);
      const tempPath = `${filePath}.tmp`;
      const payload: PersistedCacheRecord = {
        ...entry,
        updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(tempPath, JSON.stringify(payload), 'utf8');
      await fs.rename(tempPath, filePath);

      this.writeCount += 1;
      if (this.writeCount % CLEANUP_WRITE_INTERVAL === 0) {
        void this.cleanup();
      }
    } catch {
      // Ignore disk cache write failures.
    }
  }

  private async cleanup() {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }

    this.cleanupPromise = (async () => {
      try {
        await this.ensureInitialized();
        const entries = await fs.readdir(this.cacheDirectoryPath, {
          withFileTypes: true,
        });
        const fileNames = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => entry.name);
        if (fileNames.length <= MAX_DISK_CACHE_FILES) {
          return;
        }

        const stats = await Promise.all(
          fileNames.map(async (fileName) => {
            const filePath = join(this.cacheDirectoryPath, fileName);
            const stat = await fs.stat(filePath);
            return {
              fileName,
              mtimeMs: stat.mtimeMs,
            };
          }),
        );

        stats.sort((left, right) => right.mtimeMs - left.mtimeMs);
        const staleFiles = stats.slice(MAX_DISK_CACHE_FILES);
        await Promise.all(
          staleFiles.map(async (staleFile) => {
            const filePath = join(this.cacheDirectoryPath, staleFile.fileName);
            await fs.unlink(filePath).catch((): void => undefined);
          }),
        );
      } catch {
        // Ignore disk cache cleanup failures.
      } finally {
        this.cleanupPromise = null;
      }
    })();

    return this.cleanupPromise;
  }
}
