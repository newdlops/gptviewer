# GPTViewer 이미지/원본 가져오기 핸드오프 (최신 압축)

## TL;DR
- import 단계에서 이미지 eager 해석을 사실상 제거하고, 렌더러 lazy + 백그라운드 워커 큐 기반으로 전환함.
- 메모리 캐시만 있던 구조를 디스크 캐시까지 확장해서 앱 재실행 후에도 재사용 가능하게 함.
- 일부 이미지(fileId)에 대해 여전히 워커 timeout(40s) 케이스가 있어 referrer/부트스트랩 폴백을 추가했고 재검증 필요.

## 현재 핵심 동작

### 1) 이미지는 무조건 lazy 경로로 처리
파일: `src/main/services/sharedConversationRefresh/strategies/DirectChatConversationImportStrategy.ts`
- `EAGER_IMAGE_ASSET_RESOLVE_LIMIT = 0`으로 설정.
- import 단계에서 대량 이미지 fetch로 막히지 않고 메시지 파싱만 우선 완료.
- 느림 경고(`chat-import-may-be-slow`)는 유지.

### 2) 렌더러 이미지 뷰포트 lazy + ChatGPT 자산 resolve
파일: `src/renderer/features/messages/components/MarkdownImageViewport.tsx`
- `IntersectionObserver` 진입 전까지 실제 이미지 resolve/fetch 안 함.
- `sediment://file_*`뿐 아니라 `chatgpt.com/backend-api/estuary/content`, `.../files/...`, `?id=file_*` 패턴도 워커 resolve 경로 사용.
- 로딩 경고 문구 추가(큰 대화/이미지 다수 시 지연 가능).

### 3) 메인 이미지 워커 큐/중복제거/타임아웃
파일: `src/main/index.ts`
- IPC `chatgpt-image:resolve`:
  - 메모리 캐시 hit 우선
  - in-flight dedupe
  - 큐 enqueue 후 단일 워커 처리
- 로그:
  - `queue`, `worker-start`, `worker-dequeue`, `resolve-start`, `resolve-success|resolve-miss`, `worker-task-done`
- timeout:
  - `CHATGPT_IMAGE_RESOLVE_TASK_TIMEOUT_MS = 40_000`
  - timeout/error 시 워커 view 닫고 다음 작업 진행.

### 4) 재실행 유지 디스크 캐시 추가
파일:
- `src/main/services/sharedConversationRefresh/chatgpt/chatGptImageAssetCache.ts` (신규)
- `src/main/index.ts`
- 저장 위치: `app.getPath('userData')/chatgpt-image-cache`
- 키: `conversationUrl::(fileId or normalizedAssetUrl)`
- resolve 성공 시 메모리 + 디스크 저장.
- 앱 재실행 후 디스크 hit 시 `chatgpt-image:cache-hit-disk` 로그.

### 5) fetch 경로 최적화 + referrer 강화
파일:
- `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationImportScripts.ts`
- `src/main/index.ts`
- endpoint 후보를 축소/우선순위화(`download` 계열 우선).
- JSON 응답에서 `download_url/signed_url/url` 즉시 우선 사용.
- fetch 스크립트에 `referrerUrl` 파라미터 추가 후, 메인에서 `normalizedChatUrl` 전달.
- 루트 부트스트랩에서 헤더 미확보 시 대화 URL로 2차 부트스트랩(`worker-bootstrap-chat`) 수행.

### 6) 뷰포트(줌/맞춤/자동조절) 방어 로직 보강
파일: `src/renderer/features/messages/lib/useZoomableDiagramViewport.ts`
- 이미지 `naturalWidth/Height` 기반 메트릭 측정 추가.
- transform/scale sanitize(`NaN`, 0, 비정상 값 클램프) 추가.
- zoom 시 최신 메트릭 강제 갱신 경로 추가.

### 7) EIO 로그 크래시 방지
파일: `src/main/index.ts`
- `console.info/warn`가 `write EIO`를 던질 때 메인 프로세스가 죽지 않도록 safe logger 래퍼 적용.

## 최근 관찰 로그 / 상태
- 재현 로그:
  - `chatgpt-image:worker-timeout ... timeoutMs=40000`
  - 특정 fileId가 간헐적으로 timeout.
- 바로 전 조치:
  - referrer를 대화 URL로 고정,
  - 헤더 미확보 시 대화 URL 2차 부트스트랩.
- 다음 검증에서 확인할 로그:
  - `chatgpt-image:worker-bootstrap`
  - `chatgpt-image:worker-bootstrap-chat` (필요 시)
  - `chatgpt-image:resolve-success` 또는 `resolve-miss`
  - `chatgpt-image:cache-hit-disk` (앱 재시작 후)

## 비고
- `service_worker_storage.cc Failed to delete the database`는 세션 초기화(clearStorageData) 시 Chromium 내부 IO 로그로 보이며, 현재는 기능 저하 없이 지나가는 케이스가 있었음.
- main 워크트리는 변경 파일이 많은 상태(.idea/workspace.xml 포함)라 커밋 전 범위 확인 필요.

## 검증
- 최근 변경 이후 반복적으로 통과:
  - `npx tsc --noEmit`
  - `npm run -s lint`
  - IntelliJ build(project) success
