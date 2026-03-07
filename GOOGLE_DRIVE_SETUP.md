# Google Drive 연동 설정

`gptviewer`의 Google Drive 동기화는 현재 `appDataFolder`에 작업 공간 스냅샷을 저장합니다.

## 1. Google Cloud에서 OAuth 클라이언트 만들기

1. Google Cloud Console에서 프로젝트를 생성합니다.
2. `Google Drive API`를 활성화합니다.
3. `사용자 인증 정보`에서 `OAuth 클라이언트 ID`를 만듭니다.
4. 애플리케이션 유형은 `데스크톱 앱`을 선택합니다.

## 2. 앱 실행 전 환경 변수 설정

두 가지 방법 중 하나를 쓰면 됩니다.

### 방법 A. 클라이언트 ID 직접 지정

```bash
export GOOGLE_OAUTH_CLIENT_ID="여기에-클라이언트-ID"
export GOOGLE_OAUTH_CLIENT_SECRET="여기에-클라이언트-시크릿"
npm run dev
```

`GOOGLE_OAUTH_CLIENT_SECRET`은 선택 사항입니다. 데스크톱 앱 + PKCE 흐름에서는 없는 경우도 동작하도록 구현되어 있습니다.

### 방법 B. Google이 내려준 JSON 경로 지정

```bash
export GOOGLE_OAUTH_DESKTOP_CREDENTIALS_PATH="/abs/path/to/client_secret_xxx.json"
npm run dev
```

이 방식이면 JSON 안의 `installed.client_id`, `installed.client_secret`를 읽습니다.

## 3. 앱에서 실행

1. 좌측 하단 `Google Drive 로그인`
2. 브라우저에서 Google 로그인
3. 앱으로 돌아와 `Drive에 저장`
4. 다른 시점에 `Drive에서 복원`

## 현재 구현 범위

- 수동 로그인
- 수동 `Drive에 저장`
- 수동 `Drive에서 복원`
- 토큰은 Electron `userData` 아래에 저장되며, 가능하면 `safeStorage`로 암호화됩니다.

## 아직 없는 기능

- 자동 주기 동기화
- 충돌 해결 UI
- 다중 파일 분할 저장
- OS 키체인 저장
