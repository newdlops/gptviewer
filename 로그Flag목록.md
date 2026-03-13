# GPTViewer 네트워크 로그 Flag 목록

네트워크 모니터링 로그는 `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor.ts` 파일 상단의 `MONITOR_LOG_FLAGS` 객체를 통해 제어할 수 있습니다.

## 설정 위치
`src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor.ts`

```typescript
export const MONITOR_LOG_FLAGS = {
    SHOW_BACKUP_REQUESTS: false,   // session.webRequest 기반 모든 URL 캡처 로그
    SHOW_SENTINEL_FLOW: true,      // Sentinel (prepare/finalize) 관련 헤더 및 바디 로그
    SHOW_CONVERSATION_FLOW: true,  // f/conversation 관련 스트림 및 바디 로그
    SHOW_AUTH_CAPTURE: true,       // Authorization 헤더 캡처 성공 로그
    SHOW_GENERAL_REQUESTS: false,  // 모든 /backend-api/ 요청 URL 모니터링 로그
    SHOW_MAPPING: true,            // Sentinel 토큰 매핑 관련 알림 로그

    // 상세 내용 제어 (위 흐름이 활성화된 경우에만 적용)
    SHOW_REQUEST_HEADERS: true,    // 요청 헤더 출력 여부
    SHOW_REQUEST_BODY: true,       // 요청 바디 출력 여부
    SHOW_RESPONSE_HEADERS: true,   // 응답 헤더 출력 여부
    SHOW_RESPONSE_BODY: true,      // 응답 바디 출력 여부
};
```

## 각 Flag 설명

| Flag 이름 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `SHOW_BACKUP_REQUESTS` | `false` | Electron 세션 레벨에서 감지되는 모든 URL 요청을 로그합니다. 양이 매우 많을 수 있습니다. |
| `SHOW_SENTINEL_FLOW` | `true` | 4단계 자동화 흐름(Sentinel) 중 발생하는 중요 API의 로그를 활성화합니다. |
| `SHOW_CONVERSATION_FLOW` | `true` | 실제 대화 메시지 전송 및 응답 수신 API의 로그를 활성화합니다. |
| `SHOW_AUTH_CAPTURE` | `true` | ChatGPT 인증 토큰(Authorization)이 갱신되거나 캡처될 때 로그합니다. |
| `SHOW_GENERAL_REQUESTS` | `false` | 모든 `/backend-api/` 요청에 대해 URL만 간단히 로그합니다. |
| `SHOW_MAPPING` | `true` | 응답 바디에서 Sentinel용 특수 토큰들을 추출하여 매핑할 때 로그합니다. |
| `SHOW_REQUEST_HEADERS` | `true` | 활성화된 흐름에 대해 **요청 헤더**를 출력합니다. |
| `SHOW_REQUEST_BODY` | `true` | 활성화된 흐름에 대해 **요청 바디**를 출력합니다. |
| `SHOW_RESPONSE_HEADERS` | `true` | 활성화된 흐름에 대해 **응답 헤더**를 출력합니다. |
| `SHOW_RESPONSE_BODY` | `true` | 활성화된 흐름에 대해 **응답 바디**를 출력합니다. |

---

**참고:** `https://chatgpt.com/backend-api/settings/user` API의 응답 바디는 구독 기반 모델 목록 파악을 위해 위 설정과 관계없이 **항상 로그**되도록 설정되어 있습니다.
