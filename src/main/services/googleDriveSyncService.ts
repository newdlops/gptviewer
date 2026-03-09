import { app, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type {
  GoogleDriveConfigInput,
  GoogleDriveConfigSummary,
  GoogleDriveConfigSource,
  GoogleDriveSyncStatus,
} from '../../shared/sync/googleDriveSync';
import type { WorkspaceSnapshot } from '../../shared/sync/workspaceSnapshot';

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_IDENTITY_SCOPES = ['openid', 'email'];
const GOOGLE_OAUTH_SCOPE = [...GOOGLE_IDENTITY_SCOPES, GOOGLE_DRIVE_SCOPE].join(' ');
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DRIVE_UPLOAD_ENDPOINT =
  'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_CLOUD_CONSOLE_CREDENTIALS_URL =
  'https://console.cloud.google.com/apis/credentials';
const GOOGLE_DRIVE_WORKSPACE_FILE_NAME = 'workspace.json';
const GOOGLE_DRIVE_WORKSPACE_APP_KEY = 'gptviewer.workspace';
const GOOGLE_DRIVE_WORKSPACE_APP_VALUE = 'snapshot';
const GOOGLE_AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const GOOGLE_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

type GoogleOAuthConfig = {
  clientId: string;
  clientSecret?: string;
};

type StoredGoogleTokens = {
  accessToken: string;
  accountEmail?: string;
  expiryDate: number;
  idToken?: string;
  refreshToken?: string;
  scope: string;
  tokenType: string;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleDriveFileMetadata = {
  id: string;
  modifiedTime?: string;
  name: string;
};

type StoredGoogleTokenFile = {
  encrypted: boolean;
  payload: string;
};

type StoredGoogleConfigFile = {
  encrypted: boolean;
  payload: string;
};

const buildDisabledStatus = (
  message = 'Google Drive 연동 설정이 필요합니다.',
): GoogleDriveSyncStatus => ({
  hasRemoteSnapshot: false,
  isConfigured: false,
  isSignedIn: false,
  message,
  phase: 'disabled',
  provider: 'google-drive',
});

const toBase64Url = (value: Buffer | string): string =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const createCodeVerifier = (): string => toBase64Url(randomBytes(64));

const createCodeChallenge = (codeVerifier: string): string =>
  toBase64Url(createHash('sha256').update(codeVerifier).digest());

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  const segments = token.split('.');

  if (segments.length < 2) {
    return null;
  }

  try {
    const payload = segments[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(segments[1].length / 4) * 4, '=');

    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
};

const getGoogleAccountEmail = (tokenResponse: GoogleTokenResponse): string | undefined => {
  if (!tokenResponse.id_token) {
    return undefined;
  }

  const payload = parseJwtPayload(tokenResponse.id_token);
  return typeof payload?.email === 'string' ? payload.email : undefined;
};

const parseGoogleTokenResponse = (
  tokenResponse: GoogleTokenResponse,
  previousTokens?: StoredGoogleTokens,
): StoredGoogleTokens => ({
  accessToken: tokenResponse.access_token,
  accountEmail:
    getGoogleAccountEmail(tokenResponse) ?? previousTokens?.accountEmail,
  expiryDate:
    Date.now() + Math.max((tokenResponse.expires_in ?? 3600) - 30, 30) * 1000,
  idToken: tokenResponse.id_token ?? previousTokens?.idToken,
  refreshToken: tokenResponse.refresh_token ?? previousTokens?.refreshToken,
  scope: tokenResponse.scope ?? previousTokens?.scope ?? GOOGLE_OAUTH_SCOPE,
  tokenType: tokenResponse.token_type ?? previousTokens?.tokenType ?? 'Bearer',
});

const isTokenFresh = (tokens: StoredGoogleTokens): boolean =>
  tokens.expiryDate - Date.now() > GOOGLE_TOKEN_REFRESH_BUFFER_MS;

const buildQueryString = (params: Record<string, string>): string =>
  new URLSearchParams(params).toString();

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isScopeInsufficientError = (status: number, errorText: string): boolean =>
  status === 403 &&
  (errorText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
    errorText.includes('insufficientPermissions') ||
    errorText.includes('Request had insufficient authentication scopes'));

const isDriveApiDisabledError = (status: number, errorText: string): boolean =>
  status === 403 &&
  (errorText.includes('Google Drive API has not been used in project') ||
    errorText.includes('drive.googleapis.com/overview?project=') ||
    errorText.includes('accessNotConfigured'));

const extractFirstUrl = (value: string): string | undefined =>
  value.match(/https:\/\/[^\s"}]+/i)?.[0];

export class GoogleDriveSyncService {
  private cachedTokens: StoredGoogleTokens | null = null;

  private status: GoogleDriveSyncStatus = buildDisabledStatus();

  private get tokenFilePath(): string {
    return join(app.getPath('userData'), 'google-drive-auth.json');
  }

  private get configFilePath(): string {
    return join(app.getPath('userData'), 'google-drive-config.json');
  }

  private readStoredConfigSync(): GoogleOAuthConfig | null {
    try {
      const rawValue = readFileSync(this.configFilePath, 'utf8');
      const storedFile = JSON.parse(rawValue) as StoredGoogleConfigFile;

      if (
        !storedFile ||
        typeof storedFile !== 'object' ||
        typeof storedFile.payload !== 'string' ||
        typeof storedFile.encrypted !== 'boolean'
      ) {
        return null;
      }

      const serializedPayload = storedFile.encrypted
        ? safeStorage.isEncryptionAvailable()
          ? safeStorage
              .decryptString(Buffer.from(storedFile.payload, 'base64'))
              .toString()
          : ''
        : Buffer.from(storedFile.payload, 'base64').toString('utf8');

      if (!serializedPayload) {
        return null;
      }

      const config = JSON.parse(serializedPayload) as GoogleOAuthConfig;

      if (!isNonEmptyString(config.clientId)) {
        return null;
      }

      return {
        clientId: config.clientId.trim(),
        clientSecret: isNonEmptyString(config.clientSecret)
          ? config.clientSecret.trim()
          : undefined,
      };
    } catch {
      return null;
    }
  }

  private async writeStoredConfig(
    config: GoogleOAuthConfig | null,
  ): Promise<void> {
    if (!config) {
      try {
        await fs.unlink(this.configFilePath);
      } catch {
        // Ignore missing file errors.
      }
      return;
    }

    const serializedConfig = JSON.stringify(config);
    const encrypted = safeStorage.isEncryptionAvailable();
    const payload = encrypted
      ? safeStorage.encryptString(serializedConfig).toString('base64')
      : Buffer.from(serializedConfig, 'utf8').toString('base64');

    await fs.writeFile(
      this.configFilePath,
      JSON.stringify({
        encrypted,
        payload,
      } satisfies StoredGoogleConfigFile),
      'utf8',
    );
  }

  private loadOAuthConfigWithSource():
    | {
        config: GoogleOAuthConfig;
        source: GoogleDriveConfigSource;
      }
    | null {
    const storedConfig = this.readStoredConfigSync();

    if (storedConfig) {
      return {
        config: storedConfig,
        source: 'app',
      };
    }

    if (isNonEmptyString(process.env.GOOGLE_OAUTH_CLIENT_ID)) {
      return {
        config: {
          clientId: process.env.GOOGLE_OAUTH_CLIENT_ID.trim(),
          clientSecret: isNonEmptyString(process.env.GOOGLE_OAUTH_CLIENT_SECRET)
            ? process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim()
            : undefined,
        },
        source: 'env',
      };
    }

    const credentialsPath = process.env.GOOGLE_OAUTH_DESKTOP_CREDENTIALS_PATH;

    if (!isNonEmptyString(credentialsPath)) {
      return null;
    }

    try {
      const rawCredentials = readFileSync(credentialsPath.trim(), 'utf8');
      const parsedCredentials = JSON.parse(rawCredentials) as {
        installed?: {
          client_id?: string;
          client_secret?: string;
        };
      };

      if (!isNonEmptyString(parsedCredentials.installed?.client_id)) {
        return null;
      }

      return {
        config: {
          clientId: parsedCredentials.installed.client_id.trim(),
          clientSecret: isNonEmptyString(parsedCredentials.installed.client_secret)
            ? parsedCredentials.installed.client_secret.trim()
            : undefined,
        },
        source: 'file',
      };
    } catch {
      return null;
    }
  }

  private loadOAuthConfig(): GoogleOAuthConfig | null {
    return this.loadOAuthConfigWithSource()?.config ?? null;
  }

  private async readStoredTokens(): Promise<StoredGoogleTokens | null> {
    if (this.cachedTokens) {
      return this.cachedTokens;
    }

    try {
      const rawValue = await fs.readFile(this.tokenFilePath, 'utf8');
      const storedFile = JSON.parse(rawValue) as StoredGoogleTokenFile;

      if (
        !storedFile ||
        typeof storedFile !== 'object' ||
        typeof storedFile.payload !== 'string' ||
        typeof storedFile.encrypted !== 'boolean'
      ) {
        return null;
      }

      const serializedPayload = storedFile.encrypted
        ? safeStorage.isEncryptionAvailable()
          ? safeStorage
              .decryptString(Buffer.from(storedFile.payload, 'base64'))
              .toString()
          : ''
        : Buffer.from(storedFile.payload, 'base64').toString('utf8');

      if (!serializedPayload) {
        return null;
      }

      const tokens = JSON.parse(serializedPayload) as StoredGoogleTokens;

      if (!isNonEmptyString(tokens.accessToken) || !Number.isFinite(tokens.expiryDate)) {
        return null;
      }

      this.cachedTokens = tokens;
      return tokens;
    } catch {
      return null;
    }
  }

  private async writeStoredTokens(tokens: StoredGoogleTokens | null): Promise<void> {
    this.cachedTokens = tokens;

    if (!tokens) {
      try {
        await fs.unlink(this.tokenFilePath);
      } catch {
        // Ignore missing file errors.
      }
      return;
    }

    const serializedTokens = JSON.stringify(tokens);
    const encrypted = safeStorage.isEncryptionAvailable();
    const payload = encrypted
      ? safeStorage.encryptString(serializedTokens).toString('base64')
      : Buffer.from(serializedTokens, 'utf8').toString('base64');

    await fs.writeFile(
      this.tokenFilePath,
      JSON.stringify({
        encrypted,
        payload,
      } satisfies StoredGoogleTokenFile),
      'utf8',
    );
  }

  private async exchangeCodeForTokens(
    config: GoogleOAuthConfig,
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<StoredGoogleTokens> {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      body: buildQueryString({
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google 토큰을 발급받지 못했습니다. (${response.status}) ${errorText}`.trim(),
      );
    }

    const tokenResponse = (await response.json()) as GoogleTokenResponse;
    return parseGoogleTokenResponse(tokenResponse);
  }

  private async refreshAccessToken(
    config: GoogleOAuthConfig,
    refreshToken: string,
    previousTokens: StoredGoogleTokens,
  ): Promise<StoredGoogleTokens> {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      body: buildQueryString({
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google 액세스 토큰을 새로고침하지 못했습니다. (${response.status}) ${errorText}`.trim(),
      );
    }

    const tokenResponse = (await response.json()) as GoogleTokenResponse;
    const nextTokens = parseGoogleTokenResponse(tokenResponse, previousTokens);
    await this.writeStoredTokens(nextTokens);
    return nextTokens;
  }

  private async ensureAccessToken(): Promise<StoredGoogleTokens> {
    const config = this.loadOAuthConfig();

    if (!config) {
      throw new Error('Google OAuth 설정이 없습니다.');
    }

    const storedTokens = await this.readStoredTokens();

    if (!storedTokens) {
      throw new Error('Google Drive에 로그인되어 있지 않습니다.');
    }

    if (isTokenFresh(storedTokens)) {
      return storedTokens;
    }

    if (!storedTokens.refreshToken) {
      throw new Error('Google Drive 세션을 새로고칠 수 없습니다. 다시 로그인해 주세요.');
    }

    return this.refreshAccessToken(config, storedTokens.refreshToken, storedTokens);
  }

  private async runOAuthFlow(
    config: GoogleOAuthConfig,
  ): Promise<StoredGoogleTokens> {
    const state = toBase64Url(randomBytes(24));
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    const authCodeResult = await new Promise<{
      code: string;
      redirectUri: string;
    }>((resolve, reject) => {
      const server = createServer((request, response) => {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        const returnedState = requestUrl.searchParams.get('state');
        const authCode = requestUrl.searchParams.get('code');
        const authError = requestUrl.searchParams.get('error');

        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
        });
        response.end(`
          <!doctype html>
          <html lang="ko">
            <head>
              <meta charset="utf-8" />
              <title>gptviewer Google Drive 연결</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                  background: #f6f3ea;
                  color: #1e1b16;
                  display: grid;
                  place-items: center;
                  min-height: 100vh;
                  margin: 0;
                }
                main {
                  max-width: 460px;
                  padding: 28px 32px;
                  border-radius: 18px;
                  background: #ffffff;
                  box-shadow: 0 18px 48px rgba(23, 20, 16, 0.12);
                }
              </style>
            </head>
            <body>
              <main>
                <h1>Google Drive 연결이 완료되었습니다.</h1>
                <p>이 창을 닫고 gptviewer로 돌아가면 됩니다.</p>
              </main>
            </body>
          </html>
        `);

        if (authError) {
          cleanup();
          reject(new Error(`Google 로그인에 실패했습니다. (${authError})`));
          return;
        }

        if (!authCode) {
          cleanup();
          reject(new Error('Google 인증 코드를 받지 못했습니다.'));
          return;
        }

        if (returnedState !== state) {
          cleanup();
          reject(new Error('Google 인증 상태 검증에 실패했습니다.'));
          return;
        }

        cleanup();
        resolve({
          code: authCode,
          redirectUri,
        });
      });

      let timeoutId: NodeJS.Timeout | null = null;
      let redirectUri = '';

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        server.close();
      };

      server.listen(0, '127.0.0.1', async () => {
        const address = server.address() as AddressInfo | null;

        if (!address || typeof address.port !== 'number') {
          cleanup();
          reject(new Error('로컬 인증 포트를 열지 못했습니다.'));
          return;
        }

        redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;

        const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('client_id', config.clientId);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('include_granted_scopes', 'true');
        authUrl.searchParams.set('prompt', 'select_account');
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPE);
        authUrl.searchParams.set('state', state);

        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Google 로그인 시간이 초과되었습니다.'));
        }, GOOGLE_AUTH_TIMEOUT_MS);

        try {
          await shell.openExternal(authUrl.toString());
        } catch (error) {
          cleanup();
          reject(
            error instanceof Error
              ? error
              : new Error('브라우저에서 Google 로그인 페이지를 열지 못했습니다.'),
          );
        }
      });
    });

    return this.exchangeCodeForTokens(
      config,
      authCodeResult.code,
      codeVerifier,
      authCodeResult.redirectUri,
    );
  }

  private async driveFetch<T>(
    input: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<T> {
    const tokens = await this.ensureAccessToken();
    const response = await fetch(input, {
      ...init,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        ...(init.headers ?? {}),
      },
    } as RequestInit); // 명시적 캐스팅으로 BodyInit 호환성 해결

    if (response.status === 401 && retry && tokens.refreshToken) {
      const config = this.loadOAuthConfig();

      if (!config) {
        throw new Error('Google OAuth 설정이 없습니다.');
      }

      await this.refreshAccessToken(config, tokens.refreshToken, tokens);
      return this.driveFetch<T>(input, init, false);
    }

    if (!response.ok) {
      const errorText = await response.text();

      if (isScopeInsufficientError(response.status, errorText)) {
        await this.writeStoredTokens(null);
        this.status = {
          hasRemoteSnapshot: false,
          isConfigured: !!this.loadOAuthConfig(),
          isSignedIn: false,
          message:
            'Google Drive 권한이 부족합니다. 연동 해제 후 다시 연동해 주세요.',
          phase: 'signed-out',
          provider: 'google-drive',
        };
        throw new Error(this.status.message);
      }

      if (isDriveApiDisabledError(response.status, errorText)) {
        const enableUrl =
          extractFirstUrl(errorText) ??
          'https://console.cloud.google.com/apis/library/drive.googleapis.com';

        this.status = {
          accountEmail: tokens.accountEmail,
          hasRemoteSnapshot: false,
          isConfigured: !!this.loadOAuthConfig(),
          isSignedIn: true,
          message:
            'Google Drive API가 비활성화되어 있습니다. Google Cloud Console에서 Drive API를 먼저 켜 주세요.',
          phase: 'error',
          provider: 'google-drive',
        };

        throw new Error(`${this.status.message} ${enableUrl}`.trim());
      }

      throw new Error(
        `Google Drive 요청에 실패했습니다. (${response.status}) ${errorText}`.trim(),
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async getRemoteWorkspaceFile():
    Promise<GoogleDriveFileMetadata | null> {
    const query = [
      `name = '${GOOGLE_DRIVE_WORKSPACE_FILE_NAME}'`,
      `'appDataFolder' in parents`,
      'trashed = false',
      `appProperties has { key='${GOOGLE_DRIVE_WORKSPACE_APP_KEY}' and value='${GOOGLE_DRIVE_WORKSPACE_APP_VALUE}' }`,
    ].join(' and ');
    const requestUrl = new URL(GOOGLE_DRIVE_FILES_ENDPOINT);

    requestUrl.searchParams.set('fields', 'files(id,name,modifiedTime)');
    requestUrl.searchParams.set('pageSize', '1');
    requestUrl.searchParams.set('q', query);
    requestUrl.searchParams.set('spaces', 'appDataFolder');

    const response = await this.driveFetch<{
      files?: GoogleDriveFileMetadata[];
    }>(requestUrl.toString());

    return response.files?.[0] ?? null;
  }

  private createMultipartUploadBody(
    metadata: Record<string, unknown>,
    snapshot: WorkspaceSnapshot,
  ): {
    body: Buffer;
    boundary: string;
  } {
    const boundary = `gptviewer-${randomBytes(12).toString('hex')}`;
    const head = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      '',
    ].join('\r\n');
    const tail = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(head, 'utf8'),
      Buffer.from(JSON.stringify(snapshot), 'utf8'),
      Buffer.from(tail, 'utf8'),
    ]);

    return {
      body,
      boundary,
    };
  }

  private async updateStatusFromSession(
    overrides: Partial<GoogleDriveSyncStatus> = {},
  ): Promise<GoogleDriveSyncStatus> {
    const config = this.loadOAuthConfig();

    if (!config) {
      this.status = buildDisabledStatus();
      return this.status;
    }

    const tokens = await this.readStoredTokens();

    if (!tokens) {
      this.status = {
        hasRemoteSnapshot: false,
        isConfigured: true,
        isSignedIn: false,
        message: 'Google Drive에 로그인되어 있지 않습니다.',
        phase: 'signed-out',
        provider: 'google-drive',
        ...overrides,
      };
      return this.status;
    }

    let remoteWorkspaceFile: GoogleDriveFileMetadata | null = null;

    try {
      remoteWorkspaceFile = await this.getRemoteWorkspaceFile();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Google Drive API가 비활성화되어 있습니다.')
      ) {
        this.status = {
          accountEmail: tokens.accountEmail,
          hasRemoteSnapshot: false,
          isConfigured: true,
          isSignedIn: true,
          message:
            'Google Drive API가 비활성화되어 있습니다. Google Cloud Console에서 Drive API를 먼저 켜 주세요.',
          phase: 'error',
          provider: 'google-drive',
          ...overrides,
        };
        return this.status;
      }

      const latestTokens = await this.readStoredTokens();

      if (!latestTokens) {
        this.status = {
          hasRemoteSnapshot: false,
          isConfigured: true,
          isSignedIn: false,
          message:
            'Google Drive 권한이 부족하거나 세션이 만료되었습니다. 다시 연동해 주세요.',
          phase: 'signed-out',
          provider: 'google-drive',
          ...overrides,
        };
        return this.status;
      }

      remoteWorkspaceFile = null;
    }

    this.status = {
      accountEmail: tokens.accountEmail,
      hasRemoteSnapshot: !!remoteWorkspaceFile,
      isConfigured: true,
      isSignedIn: true,
      lastSyncedAt: remoteWorkspaceFile?.modifiedTime ?? overrides.lastSyncedAt,
      message:
        overrides.message ??
        (remoteWorkspaceFile
          ? 'Google Drive 백업이 연결되어 있습니다.'
          : '아직 Google Drive 백업 파일이 없습니다.'),
      phase: overrides.phase ?? 'idle',
      provider: 'google-drive',
      ...overrides,
    };

    return this.status;
  }

  async getStatus(): Promise<GoogleDriveSyncStatus> {
    return this.updateStatusFromSession();
  }

  async getConfigSummary(): Promise<GoogleDriveConfigSummary> {
    const configWithSource = this.loadOAuthConfigWithSource();

    if (!configWithSource) {
      return {
        hasClientSecret: false,
        isConfigured: false,
        setupUrl: GOOGLE_CLOUD_CONSOLE_CREDENTIALS_URL,
        source: 'none',
      };
    }

    return {
      clientId: configWithSource.config.clientId,
      hasClientSecret: !!configWithSource.config.clientSecret,
      isConfigured: true,
      setupUrl: GOOGLE_CLOUD_CONSOLE_CREDENTIALS_URL,
      source: configWithSource.source,
    };
  }

  async saveConfig(
    input: GoogleDriveConfigInput,
  ): Promise<GoogleDriveConfigSummary> {
    const nextClientId = input.clientId.trim();

    if (!nextClientId) {
      throw new Error('Google OAuth 클라이언트 ID를 입력해 주세요.');
    }

    const previousConfig = this.readStoredConfigSync();
    const nextClientSecret = isNonEmptyString(input.clientSecret)
      ? input.clientSecret.trim()
      : input.keepExistingClientSecret
        ? previousConfig?.clientSecret
        : undefined;

    await this.writeStoredConfig({
      clientId: nextClientId,
      ...(nextClientSecret ? { clientSecret: nextClientSecret } : {}),
    });
    await this.writeStoredTokens(null);
    this.status = {
      hasRemoteSnapshot: false,
      isConfigured: true,
      isSignedIn: false,
      message: 'Google Drive 연동 설정이 저장되었습니다. 다시 연동해 주세요.',
      phase: 'signed-out',
      provider: 'google-drive',
    };

    return this.getConfigSummary();
  }

  async signIn(): Promise<GoogleDriveSyncStatus> {
    const config = this.loadOAuthConfig();

    if (!config) {
      this.status = buildDisabledStatus(
        'GOOGLE_OAUTH_CLIENT_ID 또는 GOOGLE_OAUTH_DESKTOP_CREDENTIALS_PATH 설정이 필요합니다.',
      );
      return this.status;
    }

    this.status = {
      ...this.status,
      hasRemoteSnapshot: false,
      isConfigured: true,
      isSignedIn: false,
      message: 'Google 로그인 중입니다...',
      phase: 'syncing',
      provider: 'google-drive',
    };

    try {
      const tokens = await this.runOAuthFlow(config);
      await this.writeStoredTokens(tokens);
      return this.updateStatusFromSession({
        accountEmail: tokens.accountEmail,
        message: 'Google Drive에 로그인되었습니다.',
      });
    } catch (error) {
      this.status = {
        hasRemoteSnapshot: false,
        isConfigured: true,
        isSignedIn: false,
        message:
          error instanceof Error
            ? error.message
            : 'Google 로그인에 실패했습니다.',
        phase: 'error',
        provider: 'google-drive',
      };
      return this.status;
    }
  }

  async signOut(): Promise<GoogleDriveSyncStatus> {
    await this.writeStoredTokens(null);
    this.status = {
      hasRemoteSnapshot: false,
      isConfigured: !!this.loadOAuthConfig(),
      isSignedIn: false,
      message: '이 기기에서 Google Drive 로그아웃되었습니다.',
      phase: 'signed-out',
      provider: 'google-drive',
    };
    return this.status;
  }

  async disconnect(): Promise<GoogleDriveSyncStatus> {
    const tokens = await this.readStoredTokens();

    if (tokens?.refreshToken || tokens?.accessToken) {
      const revokeToken = tokens.refreshToken ?? tokens.accessToken;

      try {
        await fetch(GOOGLE_REVOKE_ENDPOINT, {
          body: buildQueryString({
            token: revokeToken,
          }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          method: 'POST',
        });
      } catch {
        // Ignore revoke failures and still clear the local session.
      }
    }

    await this.writeStoredTokens(null);
    this.status = {
      hasRemoteSnapshot: false,
      isConfigured: !!this.loadOAuthConfig(),
      isSignedIn: false,
      message: 'Google Drive 연동이 해제되었습니다.',
      phase: 'signed-out',
      provider: 'google-drive',
    };
    return this.status;
  }

  async uploadSnapshot(snapshot: WorkspaceSnapshot): Promise<GoogleDriveSyncStatus> {
    const remoteWorkspaceFile = await this.getRemoteWorkspaceFile();
    const createMetadata = {
      appProperties: {
        [GOOGLE_DRIVE_WORKSPACE_APP_KEY]: GOOGLE_DRIVE_WORKSPACE_APP_VALUE,
      },
      mimeType: 'application/json',
      name: GOOGLE_DRIVE_WORKSPACE_FILE_NAME,
      parents: ['appDataFolder'],
    };

    if (remoteWorkspaceFile) {
      const updateMetadata = {
        appProperties: {
          [GOOGLE_DRIVE_WORKSPACE_APP_KEY]: GOOGLE_DRIVE_WORKSPACE_APP_VALUE,
        },
        mimeType: 'application/json',
        name: GOOGLE_DRIVE_WORKSPACE_FILE_NAME,
      };
      const { body, boundary } = this.createMultipartUploadBody(
        updateMetadata,
        snapshot,
      );

      await this.driveFetch<GoogleDriveFileMetadata>(
        `${GOOGLE_DRIVE_UPLOAD_ENDPOINT}/${remoteWorkspaceFile.id}?uploadType=multipart&fields=id,name,modifiedTime`,
        {
          body: body as unknown as BodyInit,
          headers: {
            'content-type': `multipart/related; boundary=${boundary}`,
            'content-length': String(body.length),
          },
          method: 'PATCH',
        },
      );
    } else {
      const { body, boundary } = this.createMultipartUploadBody(
        createMetadata,
        snapshot,
      );

      await this.driveFetch<GoogleDriveFileMetadata>(
        `${GOOGLE_DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,modifiedTime`,
        {
          body: body as unknown as BodyInit,
          headers: {
            'content-type': `multipart/related; boundary=${boundary}`,
            'content-length': String(body.length),
          },
          method: 'POST',
        },
      );
    }

    return this.updateStatusFromSession({
      lastSyncedAt: new Date().toISOString(),
      message: '작업 공간을 Google Drive에 저장했습니다.',
    });
  }

  async downloadSnapshot(): Promise<WorkspaceSnapshot | null> {
    const remoteWorkspaceFile = await this.getRemoteWorkspaceFile();

    if (!remoteWorkspaceFile) {
      await this.updateStatusFromSession({
        hasRemoteSnapshot: false,
        message: 'Google Drive에 저장된 작업 공간이 없습니다.',
      });
      return null;
    }

    const snapshot = await this.driveFetch<WorkspaceSnapshot>(
      `${GOOGLE_DRIVE_FILES_ENDPOINT}/${remoteWorkspaceFile.id}?alt=media`,
    );

    await this.updateStatusFromSession({
      hasRemoteSnapshot: true,
      lastSyncedAt: remoteWorkspaceFile.modifiedTime,
      message: 'Google Drive에서 작업 공간을 불러왔습니다.',
    });

    return snapshot;
  }
}

export const googleDriveSyncService = new GoogleDriveSyncService();
