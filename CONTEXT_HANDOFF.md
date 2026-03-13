# GPTViewer Context Handoff (2026-03-13)

## 1. 프로젝트 목적
ChatGPT 대화 데이터를 효율적으로 파싱하고, 자동화된 메시지 전송 및 실시간 새로고침 기능을 제공하는 데스크톱 어플리케이션(Electron 기반) 고도화.

## 2. 주요 구현 및 수정 사항

### A. 대화 자동화 (Sentinel Flow)
- **4단계 인증 흐름**: ChatGPT의 보안 강화에 대응하여 `prepare` -> `sentinel wakeup` -> `finalize` -> `actual conversation`의 4단계 API 호출 흐름을 `ChatGptAutomationView.ts`에 구현함.
- **모델 강제**: 모든 자동화 단계에서 `gpt-5-3` 또는 사용자가 선택한 최신 모델을 사용하도록 강제하여 하위 모델(2.5 등)로의 폴백 방지.
- **모델 선택 UI**: `ConversationInput.tsx`에 `/backend-api/settings/user`에서 파싱한 가용 모델 목록을 드롭다운으로 표시하고, 전송 시 해당 모델을 페이로드에 포함함.

### B. 데이터 파싱 및 정규화
- **SSE 스트림 파싱**: `/backend-api/f/conversation`의 SSE 스트림(delta, patch, add 형식)을 실시간으로 파싱하여 대화 내용을 복원하는 로직을 `chatGptConversationNetworkParser.ts`에 추가함.
- **작성자 정보 유지**: `SharedConversationMessage`와 `Message` 타입에 `authorName`/`name` 필드를 추가하여, `name: null`인 경우에도 "ChatGPT" 등으로 기본값을 할당해 렌더링 누락 방지.
- **타입 안정성**: `normalizers.ts`에서 메시지 변환 시 발생하던 타입 불일치(TS2677)를 명시적 타입 단언 및 인터페이스 갱신으로 해결.

### C. 네트워크 모니터링 및 종료 감지
- **초광대역 캡처**: Electron `session.webRequest`의 모든 단계에서 URL을 캡처하도록 `ChatGptConversationNetworkMonitor.ts`를 강화하여 `/lat/r` (종료 신호) 감지 신뢰도를 높임.
- **하이브리드 종료 감지**: 네트워크 신호(`/lat/`)와 DOM 상태(응답 중 아님 + 입력창 활성화)를 병행 체크하여 대화 완료 후 즉시 새로고침 트리거.
- **타임아웃 최적화**: 대기 시간을 30초로 단축하여 사용자 경험 개선.

### D. UI/UX 개선
- **스크롤 하단 고정**: `MessageList.tsx`에서 대화 데이터 갱신 시 자동으로 최하단으로 스크롤되도록 `useEffect` 로직 보강.
- **전송 버튼 상태 세분화**: `전송` -> `전송 중...` -> `응답 수신 중...` -> `전송` 순으로 상태를 UI에 표시하여 실시간 진행 상황 인지 가능하게 함.
- **비침습적 자동화**: 보조 창이 포커스를 탈취하지 않도록 `showInactive()`를 사용하고, 대부분의 작업을 백그라운드 모드에서 수행하도록 설정.

## 3. 현재 상태 및 남은 과제
- [x] 메시지 전송 및 응답 수신 로직 완성
- [x] SSE 델타 파싱 및 작성자 이름 처리
- [x] 모델 선택 드롭다운 UI 적용
- [x] 자동 스크롤 하단 고정
- [ ] `/lat/r` 감지 신뢰도 최종 검증 (로그 모니터링 필요)
- [ ] 모델 선택 드롭다운의 디자인 미세 조정 (CSS)

## 4. 기술적 참고 사항
- **네트워크 모니터**: `Debugger` 이벤트 유실에 대비해 `session.webRequest`를 백업으로 사용 중.
- **SSE 파서**: `patch` 이벤트의 `append`, `replace` 연산을 직접 구현하여 텍스트를 조립함.
- **백그라운드 뷰**: `BACKGROUND_WINDOW_OPACITY` (0.01)를 사용하여 화면에는 거의 보이지 않으면서도 동작을 유지함.
