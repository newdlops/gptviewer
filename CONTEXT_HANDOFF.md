# GPTViewer Import 이슈 핸드오프 (압축)

## 문제 요약
- 원본 ChatGPT 링크 import 시 Deep Research/이미지 대화 반영이 불완전.
- `backend-api/conversation/<id>` 호출은 `200 OK`인데, 이미지 대신 `{"size":"1024x1024","n":1}` 같은 텍스트가 표시됨.
- 일부 케이스에서 `[gptviewer][direct-chat-import:image-assets] ...` 로그가 없어 이미지 asset 파이프라인 미진입 가능성 확인됨.

## 현재까지 반영된 핵심 수정

### 1) 네트워크 JSON 파서 보강
파일: `src/main/parsers/chatGptConversationNetworkParser.ts`
- `sediment://file_*` 포인터 인식/처리 추가.
- 이미지 payload가 있는 `tool` 메시지를 `assistant`로 승격 렌더링.
- `channel=commentary`, 비공개 recipient 필터와 이미지 예외 처리 정리.
- `current_node` 경로 밖에 있는 분기 이미지 노드도 병합하도록 descriptor 빌드 로직 확장.
- Deep Research 위젯 상태(`The latest state of the widget is:`) 문자열/JSON에서 `report_message` 추출 로직 확장.

### 2) 이미지 asset fetch 스크립트 추가
파일: `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationImportScripts.ts`
- `buildFetchConversationAssetDataUrlScript(fileId, replayHeaders)` 추가.
- backend endpoint 후보 요청 + MIME 추정 + `data:image/...` URL 생성.

### 3) import 전략에서 sediment 이미지 치환
파일: `src/main/services/sharedConversationRefresh/strategies/DirectChatConversationImportStrategy.ts`
- 메시지 markdown 내 `![...](sediment://file_...)` 추출.
- backend에서 asset fetch 후 `data:image/...`로 치환.
- 진단 로그 추가:
  - `[gptviewer][direct-chat-import:image-assets] requested=... resolved=... unresolved=...`

### 4) 렌더러 URL 허용
파일: `src/renderer/features/messages/components/MessageList.tsx`
- `data:image/*`, `sediment://file_*`를 이미지 URL transform에서 허용.

## 방금 최종 원인/수정 (가장 중요)
- 원인: `collectImageParts()`가 **객체 내부 문자열**인
  - `asset_pointer: "sediment://file_..."`
  - `watermarked_asset_pointer: "sediment://file_..."`
  를 누락.
- 조치: 위 키들에서 sediment 포인터를 `![image](sediment://file_...)`로 생성하도록 분기 추가.
- 파일: `src/main/parsers/chatGptConversationNetworkParser.ts`

## 검증 상태
- `npx tsc --noEmit` 통과
- `npm run -s lint` 통과

## 다음 확인 포인트
1. 같은 링크로 다시 import.
2. 로그에 아래가 뜨는지 확인:
   - `[gptviewer][direct-chat-import:image-assets] requested=... resolved=...`
3. 분기 판단:
   - `requested=0`: 파서에서 sediment 포인터 추출 실패
   - `requested>0 && resolved=0`: asset endpoint/헤더/권한/세션 문제

## 참고 샘플
- 루트의 `a.json`은 `image_asset_pointer` + `sediment://file_...`가 다수 포함된 재현 샘플.
