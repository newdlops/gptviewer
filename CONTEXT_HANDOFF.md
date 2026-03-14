# GPTViewer 세션 핸드오프 (2026-03-13)

이 문서는 이전 세션에서 진행된 핵심 작업 내용과 현재 코드 상태를 요약하여, 다음 세션에서 작업을 즉시 재개할 수 있도록 돕습니다.

## 1. 최근 주요 변경 사항

### A. 네트워크 로그 시스템 개편
- **플래그 구조화**: `MONITOR_LOG_FLAGS`를 5가지 직관적 범주(`REQUEST_HEADERS`, `RESPONSE_HEADERS`, `REQUEST_BODY`, `RESPONSE_BODY`, `STREAM_EVENTS`)로 전면 개편.
- **문서화**: `로그Flag목록.md`에 최신 플래그 명세와 대상 API 목록 업데이트 완료.

### B. WebSocket 모니터링 및 자동 구독 (핵심)
- **URL 캡처**: `/backend-api/celsius/ws/user` 응답에서 `wss_url`을 추출하여 `latestWebSocketUrl`에 정적 캐싱.
- **실시간 구독 로직**: `sendMessageViaApi` 과정 중 `f/conversation` SSE 스트림에서 `stream_handoff` 이벤트 발생 시, 캡처된 URL로 새로운 WebSocket을 열어 `subscribe` 프레임을 즉시 전송.
- **완료 감지**: WebSocket으로 `conversation-turn-complete` 수신 시 `unsubscribe` 후 프로세스 종료. 이 모든 과정을 터미널 로그로 출력.

### C. Sentinel 보안 토큰 처리
- **안정화**: `openai-sentinel-chat-requirements-token`, `proof-token` 등을 Request/Response 양방향에서 정밀하게 파싱하도록 수정 (`[object Object]` 오류 해결).
- **호환성**: `class WebSocketProxy extends OriginalWebSocket` 방식을 통해 ChatGPT React 앱의 네이티브 소켓 동작을 방해하지 않으면서 인스턴스 가로채기 성공.

### D. UI/UX 개선
- **강제 동기화 (Force Sync)**: 프로젝트 동기화 시 기존 대화를 무시하고 모두 새로고침하는 기능 추가.
- **모델 선택기**: `settings/user` 캐시를 활용해 전송 버튼 상단에 모델 선택 드롭다운 배치.

## 2. 핵심 파일 및 역할
- `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor.ts`: 네트워크 디버깅, 토큰 추출, 소켓 상태 추적.
- `src/main/services/sharedConversationRefresh/chatgpt/ChatGptAutomationView.ts`: 4단계 Sentinel Flow 및 WebSocket 구독 실행 스크립트 포함.
- `src/main/services/sharedConversationRefresh/SharedConversationRefreshService.ts`: 상위 수준의 대화 전송 및 새로고침 서비스.

## 3. 다음 단계 가이드
- 현재 대화 전송 및 소켓 로깅은 매우 안정적인 상태입니다.
- **주의**: 대화 가져오기(`f/conversation`)의 헤더 조합과 URL 패턴은 현재 최적화되어 있으므로 건드리지 않는 것이 좋습니다.
- 필요 시 WebSocket 프레임 내의 구체적인 페이로드 분석을 추가로 진행할 수 있습니다.

---
*이 문서를 에이전트에게 제공하여 "이전 세션의 컨텍스트를 파악해줘"라고 요청하세요.*
