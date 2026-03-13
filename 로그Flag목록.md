# GPTViewer 네트워크 로그 Flag 목록

네트워크 모니터링 로그는 `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor.ts` 파일 상단의 `MONITOR_LOG_FLAGS` 객체를 통해 제어할 수 있습니다.

## 설정 위치
`src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor.ts`

```typescript
export const MONITOR_LOG_FLAGS = {
    // 1. 요청 헤더 출력
    SHOW_REQUEST_HEADERS: false,
    
    // 2. 응답 헤더 출력
    SHOW_RESPONSE_HEADERS: false,
    
    // 3. 요청 바디(Payload) 출력
    SHOW_REQUEST_BODY: false,
    
    // 4. 응답 바디 출력
    SHOW_RESPONSE_BODY: false,
    
    // 5. 스트림 이벤트 및 기타 중요 이벤트 상태 로그 (시작, 수신, 종료 등)
    SHOW_STREAM_EVENTS: true,

    // 기타 시스템 디버깅용 보조 플래그
    SHOW_BACKUP_REQUESTS: false,   // session.webRequest 기본 URL 로그
    SHOW_GENERAL_REQUESTS: false,  // 모든 /backend-api/ 단순 호출 로그
};
```

## 관찰 대상 주요 API
위 플래그들은 주로 다음 경로를 포함하는 API에 대해 작동합니다:
- `/sentinel/chat-requirements` (Sentinel 흐름)
- `/backend-api/f/conversation` (대화 전송/수신)
- `/backend-api/celsius/ws/user` (WebSocket 연결 정보)

## 각 Flag 설명

| Flag 이름 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `SHOW_REQUEST_HEADERS` | `false` | 대상 API들의 **요청 헤더(Request Headers)**를 출력합니다. |
| `SHOW_RESPONSE_HEADERS` | `false` | 대상 API들의 **응답 헤더(Response Headers)**를 출력합니다. |
| `SHOW_REQUEST_BODY` | `false` | 대상 API들의 **요청 바디(Payload)**를 출력합니다. |
| `SHOW_RESPONSE_BODY` | `false` | 대상 API들의 **응답 바디**를 출력합니다. |
| `SHOW_STREAM_EVENTS` | `true` | `/conversation/resume` 스트림의 시작, 데이터 수신(바이트), 종료 및 기타 중요 상태를 로그합니다. |
| `SHOW_BACKUP_REQUESTS` | `false` | Electron 세션 레벨에서 감지되는 모든 URL 요청을 로그합니다. |
| `SHOW_GENERAL_REQUESTS` | `false` | 모든 `/backend-api/` 요청에 대해 URL만 간단히 로그합니다. |

---

## 스트림 종료 감지 및 자동 새로고침
`gptviewer`는 `/backend-api/f/conversation/resume` API의 네트워크 스트림 상태를 직접 감시합니다. (`SHOW_STREAM_EVENTS` 활성화 시 관찰 가능)
1. **시작 감지**: 스트림 응답이 시작되면 `STREAM STARTED` 로그를 남기고 수신 상태로 전환합니다.
2. **수신 중**: 데이터 조각(chunk)이 들어올 때마다 `RECEIVING DATA` 로그와 함께 바이트 크기를 출력합니다.
3. **종료 감지**: 네트워크 수준에서 스트림이 닫히면 `STREAM FINISHED` 로그와 함께 즉시 대화 새로고침을 트리거합니다. 이 방식은 DOM 상태 감지보다 훨씬 빠르고 정확합니다.

---

**참고:** `https://chatgpt.com/backend-api/settings/user` API의 응답 바디는 구독 기반 모델 목록 파악을 위해 위 설정과 관계없이 **항상 로그**되도록 설정되어 있습니다.
