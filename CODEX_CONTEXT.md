# Codex Context Snapshot

업데이트 시점: 2026-03-07
프로젝트 루트: `/Users/ki-younglee/Desktop/project/gptviewer`

## 현재 프로젝트 상태

- 스택: Electron Forge + React + TypeScript
- 앱은 `ChatGPT 공유 대화 뷰어 + 작업 공간 트리 + Google Drive 동기화` 구조
- 최근 큰 리팩토링 목표는 `한 파일 300줄 이하` 기준으로 `AppContent` 계층 분해

## 최근 완료한 리팩토링

- [App.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/App.tsx)
  - 7줄짜리 엔트리 래퍼
- [AppContent.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/AppContent.tsx)
  - 현재 200줄
  - 상태 훅과 UI 컴포넌트를 조립하는 역할만 남김

### 새로 분리된 훅

- [useDrawerState.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useDrawerState.ts)
- [useSourcePreviewState.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useSourcePreviewState.ts)
- [useWorkspaceSnapshotState.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useWorkspaceSnapshotState.ts)
- [useWorkspaceActions.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useWorkspaceActions.ts)
- [useWorkspaceTreeActions.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useWorkspaceTreeActions.ts)
- [useSharedConversationActions.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useSharedConversationActions.ts)
- [useGoogleDriveSync.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useGoogleDriveSync.ts)
- [useGoogleDrivePreferencesState.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useGoogleDrivePreferencesState.ts)
- [useGoogleDriveConfigState.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useGoogleDriveConfigState.ts)

### 새로 분리된 UI

- [WorkspaceSidebar.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/WorkspaceSidebar.tsx)
- [GoogleDriveSyncPanel.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/GoogleDriveSyncPanel.tsx)
- [ConversationViewer.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/ConversationViewer.tsx)
- [SharedConversationImportModal.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/modals/SharedConversationImportModal.tsx)
- [WorkspaceModals.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/modals/WorkspaceModals.tsx)
- [GoogleDriveModals.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/modals/GoogleDriveModals.tsx)

## 현재 큰 기능 상태

- 왼쪽 작업 공간은 폴더 트리 + 대화 리프 구조
- 폴더 생성/이동/삭제/이름 변경 가능
- 대화 리프 드래그 앤 드롭 순서 변경 가능
- ChatGPT 공유 링크 import 가능
- 공유 대화 새로고침은 이제 전략 서비스 뒤에 있음
- 출처 프리뷰 드로어/인라인 칩 동작함
- Google Drive 로그인/로그아웃/연동 해제/자동 동기화/로컬 비우기 동작함
- Mermaid는 백그라운드 큐로 렌더링 준비

## 공유 대화 새로고침 구조

- 공용 타입: [sharedConversationRefresh.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/shared/refresh/sharedConversationRefresh.ts)
- 메인 서비스: [SharedConversationRefreshService.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/main/services/sharedConversationRefresh/SharedConversationRefreshService.ts)
- 직접 공유 링크 전략: [DirectSharedConversationRefreshStrategy.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/main/services/sharedConversationRefresh/strategies/DirectSharedConversationRefreshStrategy.ts)
- ChatGPT UI 자동화 전략: [ChatGptShareFlowRefreshStrategy.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/main/services/sharedConversationRefresh/strategies/ChatGptShareFlowRefreshStrategy.ts)
- 자동화 뷰 래퍼: [ChatGptAutomationView.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/main/services/sharedConversationRefresh/chatgpt/ChatGptAutomationView.ts)
- import 모달에서 `원본 ChatGPT 대화 URL`을 저장 가능
- 대화 헤더에 `새로고침 설정` 버튼이 추가됨
- 설정 모달: [SharedConversationRefreshConfigModal.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/modals/SharedConversationRefreshConfigModal.tsx)
- 현재 렌더러 새로고침 버튼은 `refreshSharedConversation()` IPC를 호출함

주의:
- 기존 저장 대화에는 보통 `refreshRequest.mode = direct-share-page`만 들어감
- 새 import나 설정 저장 후에는 `chatgpt-share-flow` 사용 가능
- 자동화는 `WebContentsView`를 붙인 보조 창을 열고 버튼 라벨 기준으로 Share / Update and Copy Link를 찾음
- 로그인 페이지, 보안 확인 페이지, 공유 버튼 미노출, Update and Copy Link 미노출, 클립보드 실패를 구분해 에러 메시지를 냄
- 클립보드에서 공유 링크를 읽지 못하면 보조 창 DOM에서 `input/textarea/a/bodyText`를 다시 훑어 공유 URL을 fallback으로 찾음
- ChatGPT 자동 새로고침은 로그인/보안 확인 화면이 나오면 바로 실패하지 않고 최대 2분 동안 보조 창에서 수동 로그인을 마칠 시간을 기다림
- 보조 창을 닫기 전 세션 storage flush를 시도해서 다음 새로고침 때 로그인 상태가 더 잘 유지되도록 보강함
- ChatGPT 자동화 보조 창은 이제 매 새로고침마다 새로 만들지 않고 재사용해서 같은 webContents/session을 계속 유지함
- Share 버튼이 상단에 바로 없으면 `더보기/Conversation options` 계열 메뉴를 먼저 열고 그 안에서 Share를 다시 찾음
- GPT 웹앱 구조가 바뀌면 [ChatGptDomSelectors.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/main/services/sharedConversationRefresh/chatgpt/ChatGptDomSelectors.ts)와 자동화 스크립트를 우선 수정해야 함

## 마지막 검증 상태

다음 명령 통과:

- `npx tsc --noEmit`
- `npm run lint`

## 현재 파일 크기 상태

300줄 이하로 맞춘 주요 파일:

- [AppContent.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/AppContent.tsx) 200줄
- [useGoogleDriveSync.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useGoogleDriveSync.ts) 293줄
- [useWorkspaceTreeActions.ts](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/hooks/useWorkspaceTreeActions.ts) 245줄
- [WorkspaceModals.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/app/components/modals/WorkspaceModals.tsx) 206줄

아직 큰 파일:

- [WorkspaceTree.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/conversations/components/WorkspaceTree.tsx) 792줄
- [MessageList.tsx](/Users/ki-younglee/Desktop/project/gptviewer/src/renderer/features/messages/components/MessageList.tsx) 583줄

## 다음 세션의 우선 작업

1. `WorkspaceTree.tsx`를 `folder row / conversation leaf / drag state / drop target` 단위로 분리
2. `MessageList.tsx`를 `virtual list / measurement / scroll restore / message row` 단위로 분리
3. 실제 ChatGPT 계정 세션으로 `chatgpt-share-flow` end-to-end 수동 검증
4. GPT 웹앱 DOM 변경 시 선택자 보강
5. `Update and Copy Link` 이후 DOM에 노출되는 공유 링크 패턴을 실제 서비스에서 더 넓게 수집할지 검토
6. 새로 나눈 구조에서 다시 `tsc`, `lint` 검증

## 작업 시 주의점

- `AppContent.tsx`에 로직을 다시 몰아넣지 말 것
- Google Drive 관련 상태는 `useGoogleDriveSync` 계층 아래에서 유지할 것
- 작업 공간 상태 영속화는 `useWorkspaceSnapshotState`와 conversations lib를 통해 유지할 것
- 수동 파일 편집은 `apply_patch` 기준으로 진행할 것
