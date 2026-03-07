# GPTViewer 프로젝트 분석

> 분석 시점: 2026-03-07  
> 소스 파일 수: **68개** (`.ts` / `.tsx` / `.css`)  
> 총 라인 수: **~13,636줄**

---

## 1. 프로젝트 개요

**ChatGPT 공유 대화 뷰어** 데스크톱 애플리케이션.  
ChatGPT 공유 링크를 가져와 로컬 작업 공간(폴더 트리)에서 관리·열람하고, Google Drive를 통해 동기화할 수 있다.

| 항목 | 내용 |
|------|------|
| 프레임워크 | **Electron Forge** (v7.11) + Webpack |
| UI | **React 19** + **TypeScript 5.8** |
| 마크다운 렌더링 | `react-markdown` + `remark-gfm` |
| 코드 하이라이트 | `react-syntax-highlighter` |
| 다이어그램 | `mermaid` (백그라운드 큐 렌더링) |
| 패키지 매니저 | npm 11.8, Node ≥ 24.13 |

---

## 2. 아키텍처 개략도

```
┌──────────────────────────────────────────────────────┐
│                    Electron Main Process             │
│  ┌──────────┐  ┌───────────────┐  ┌───────────────┐ │
│  │ index.ts │  │ IPC Handlers  │  │   Services    │ │
│  │ (1,014L) │  │ googleDrive.ts│  │ GDrive Sync   │ │
│  │          │  │               │  │ SC Refresh    │ │
│  └──────────┘  └───────────────┘  └───────────────┘ │
│                        │ IPC                         │
│  ┌─────────────────────┼─────────────────────────┐   │
│  │           Preload (index.ts 30L)              │   │
│  │       contextBridge · electronAPI             │   │
│  └───────────────────────────────────────────────┘   │
└───────────────────────┬──────────────────────────────┘
                        │ window.electronAPI
┌───────────────────────▼──────────────────────────────┐
│                 Renderer Process                     │
│  App → AppContent (조립 계층)                         │
│  ┌───────────┐ ┌──────────────┐ ┌─────────────────┐ │
│  │ features/ │ │ components/  │ │ hooks / lib /   │ │
│  │ app       │ │ ui (Button,  │ │ types / styles  │ │
│  │ conver-   │ │    Modal)    │ │                 │ │
│  │ sations   │ └──────────────┘ └─────────────────┘ │
│  │ messages  │                                      │
│  │ sync      │                                      │
│  └───────────┘                                      │
└──────────────────────────────────────────────────────┘
```

---

## 3. 디렉터리 구조

```
src/
├── main/                          # Electron 메인 프로세스
│   ├── index.ts                   # 앱 윈도우 생성 · 전역 IPC 등록 (1,014줄)
│   ├── ipc/
│   │   └── googleDrive.ts         # Google Drive IPC 핸들러
│   ├── parsers/
│   │   └── sourcePreviewParser.ts # 출처 미리보기 HTML 파싱 (592줄)
│   └── services/
│       ├── googleDriveSyncService.ts          # Google Drive 동기화 서비스 (1,049줄)
│       └── sharedConversationRefresh/         # 공유 대화 새로고침 서비스
│           ├── SharedConversationRefreshService.ts  # 전략 디스패치
│           ├── SharedConversationRefreshError.ts
│           ├── strategies/
│           │   ├── DirectSharedConversationRefreshStrategy.ts
│           │   └── ChatGptShareFlowRefreshStrategy.ts
│           └── chatgpt/                       # ChatGPT 자동화 모듈
│               ├── ChatGptAutomationView.ts          # WebContentsView 래퍼 (300줄)
│               ├── ChatGptDomSelectors.ts            # DOM 선택자 관리
│               ├── chatGptAutomationScripts.ts       # 자동화 스크립트 (295줄)
│               ├── chatGptConversationListScripts.ts  # 대화 목록 스크립트 (293줄)
│               ├── chatGptConversationNavigation.ts   # 대화 내비게이션 (292줄)
│               ├── chatGptConversationLoadHelpers.ts
│               ├── chatGptConversationMenuHelpers.ts
│               ├── chatGptConversationRowButtonScripts.ts
│               ├── chatGptDirectConversationNavigation.ts
│               ├── chatGptDirectConversationScripts.ts
│               └── chatGptRefreshHelpers.ts
│
├── preload/
│   └── index.ts                   # contextBridge IPC 브릿지 (30줄)
│
├── renderer/                      # React 렌더러
│   ├── index.html
│   ├── index.tsx                  # ReactDOM.render 엔트리
│   ├── App.tsx                    # 최상위 래퍼 (8줄)
│   ├── AppContent.tsx             # 상태 훅 조립 · UI 합성 (213줄)
│   │
│   ├── components/
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       └── ui.css
│   │
│   ├── features/
│   │   ├── app/                   # 앱 레벨 기능
│   │   │   ├── components/
│   │   │   │   ├── ConversationViewer.tsx
│   │   │   │   ├── GoogleDriveSyncPanel.tsx
│   │   │   │   ├── WorkspaceSidebar.tsx
│   │   │   │   └── modals/
│   │   │   │       ├── GoogleDriveModals.tsx
│   │   │   │       ├── SharedConversationImportModal.tsx
│   │   │   │       ├── SharedConversationRefreshConfigModal.tsx
│   │   │   │       └── WorkspaceModals.tsx (206줄)
│   │   │   ├── hooks/
│   │   │   │   ├── useDrawerState.ts
│   │   │   │   ├── useGoogleDriveConfigState.ts
│   │   │   │   ├── useGoogleDrivePreferencesState.ts
│   │   │   │   ├── useGoogleDriveSync.ts         (293줄)
│   │   │   │   ├── useSharedConversationActions.ts (286줄)
│   │   │   │   ├── useSourcePreviewState.ts
│   │   │   │   ├── useWorkspaceActions.ts
│   │   │   │   ├── useWorkspaceSnapshotState.ts
│   │   │   │   └── useWorkspaceTreeActions.ts    (245줄)
│   │   │   └── lib/
│   │   │       ├── appTypes.ts
│   │   │       └── sharedConversationUtils.ts
│   │   │
│   │   ├── conversations/         # 작업 공간 트리 기능
│   │   │   ├── components/
│   │   │   │   └── WorkspaceTree.tsx             (792줄) ⚠️
│   │   │   ├── data/
│   │   │   │   └── initialConversations.ts
│   │   │   ├── lib/
│   │   │   │   ├── normalizers.ts
│   │   │   │   ├── workspacePersistence.ts
│   │   │   │   ├── workspaceSnapshot.ts          (300줄)
│   │   │   │   └── workspaceTree.ts              (577줄)
│   │   │   └── styles/
│   │   │       └── workspaceTree.css             (373줄)
│   │   │
│   │   ├── messages/              # 메시지 표시 기능
│   │   │   ├── components/
│   │   │   │   ├── InlineAssistantLink.tsx
│   │   │   │   ├── MarkdownCodeBlock.tsx         (295줄)
│   │   │   │   ├── MessageList.tsx               (583줄) ⚠️
│   │   │   │   ├── SourceDrawer.tsx
│   │   │   │   └── SourceFavicon.tsx
│   │   │   ├── lib/
│   │   │   │   ├── mermaidRenderQueue.ts
│   │   │   │   └── sourceUtils.ts
│   │   │   └── styles/
│   │   │       └── message.css                   (594줄)
│   │   │
│   │   └── sync/                  # 동기화 기능
│   │       └── lib/
│   │           └── googleDrivePreferences.ts
│   │
│   ├── hooks/                     # (비어 있음 — 향후 공용 훅)
│   ├── lib/
│   │   └── theme.ts
│   ├── styles/
│   │   └── index.css              (553줄)
│   └── types/
│       ├── chat.ts                # 핵심 도메인 타입
│       └── globals.d.ts           # ElectronAPI 타입 선언
│
└── shared/                        # Main ↔ Renderer 공유 타입
    ├── refresh/
    │   ├── sharedConversationRefresh.ts
    │   └── sharedConversationRefreshErrorCodec.ts
    └── sync/
        ├── googleDriveSync.ts
        └── workspaceSnapshot.ts
```

---

## 4. 핵심 데이터 모델

### 4.1 대화 데이터

```typescript
Conversation {
  id, title, summary, sourceUrl?, fetchedAt?, updatedAt
  messages: Message[]
  refreshRequest?: SharedConversationRefreshRequest
  isSharedImport?: boolean
}

Message { id, role: 'user' | 'assistant', text, sources: MessageSource[], timestamp }
MessageSource { url, title, description?, publisher?, iconUrl?, attribution? }
```

### 4.2 작업 공간 트리

```typescript
WorkspaceNode = WorkspaceFolderNode | WorkspaceConversationNode

WorkspaceFolderNode { id, type: 'folder', name, children: WorkspaceNode[] }
WorkspaceConversationNode { id, type: 'conversation', conversationId }
```

### 4.3 Google Drive 동기화

```typescript
WorkspaceSnapshot { conversations, workspaceTree, savedAt }
GoogleDriveSyncStatus { isSignedIn, email?, fileName?, lastSyncedAt?, error? }
```

---

## 5. IPC 채널 (Preload Bridge)

| 채널 | 방향 | 용도 |
|------|------|------|
| `shared-conversation:fetch` | Renderer → Main | 공유 링크 HTML 가져오기 |
| `shared-conversation:refresh` | Renderer → Main | 공유 대화 새로고침 (전략 기반) |
| `source-preview:fetch` | Renderer → Main | 출처 URL 미리보기 파싱 |
| `source-icon:fetch` | Renderer → Main | 파비콘 프록시 |
| `google-drive-sync:sign-in` | Renderer → Main | Google 로그인 |
| `google-drive-sync:sign-out` | Renderer → Main | Google 로그아웃 |
| `google-drive-sync:disconnect` | Renderer → Main | Google 연동 해제 |
| `google-drive-sync:sync-now` | Renderer → Main | 즉시 동기화 (스냅샷 업로드) |
| `google-drive-sync:download-snapshot` | Renderer → Main | 스냅샷 다운로드 |
| `google-drive-sync:get-config` | Renderer → Main | 설정 조회 |
| `google-drive-sync:save-config` | Renderer → Main | 설정 저장 |
| `google-drive-sync:get-status` | Renderer → Main | 동기화 상태 조회 |

---

## 6. 주요 기능 흐름

### 6.1 ChatGPT 공유 대화 Import

```
사용자 → SharedConversationImportModal
       → useSharedConversationActions.handleImportSharedConversation()
       → IPC: shared-conversation:fetch
       → Main: HTML 파싱 → ImportedConversation 반환
       → Renderer: workspaceTree에 노드 추가 · conversations 맵에 저장
       → localStorage 영속화
```

### 6.2 공유 대화 새로고침 (전략 패턴)

```
SharedConversationRefreshService
├── DirectSharedConversationRefreshStrategy
│   └── 공유 링크 직접 fetch → HTML 파싱
└── ChatGptShareFlowRefreshStrategy
    └── ChatGptAutomationView (WebContentsView 기반 자동화)
        ├── ChatGPT 로그인 확인 (2분 대기)
        ├── 대화 탐색 → Share 버튼 클릭
        ├── Update and Copy Link 클릭
        └── 클립보드 / DOM fallback으로 공유 URL 추출
```

### 6.3 Google Drive 동기화

```
useGoogleDriveSync (Renderer)
  → 로그인/로그아웃/연동 해제 IPC
  → 자동 동기화 인터벌 (사용자 설정 가능)
  → syncGoogleDriveNow → WorkspaceSnapshot 업로드
  → downloadGoogleDriveSnapshot → 충돌 감지 → 복원/유지 선택

googleDriveSyncService.ts (Main)
  → Google OAuth2 인증
  → Drive API를 통한 JSON 파일 업로드/다운로드
```

### 6.4 출처 미리보기

```
사용자가 메시지 내 출처 링크 클릭
  → useSourcePreviewState.loadSourcePreview()
  → IPC: source-preview:fetch
  → Main: sourcePreviewParser.ts → HTML meta 태그 파싱
  → SourceDrawer에 결과 표시
```

---

## 7. 상태 관리 구조

React 상태는 **커스텀 훅 계층**으로 분리되어 있으며, `AppContent.tsx`가 이를 조립한다.

```
AppContent.tsx (조립 계층)
├── useDrawerState         → 사이드바 리사이즈 상태
├── useSourcePreviewState  → 출처 미리보기 · 스크롤 위치 · 높이 캐시
├── useWorkspaceSnapshotState → 작업 공간 트리 · 대화 맵 · 테마 · localStorage 영속화
│   └── workspacePersistence.ts  → localStorage 직렬화/역직렬화
│   └── workspaceSnapshot.ts     → 스냅샷 생성/복원
├── useWorkspaceActions    → Import · 폴더 CRUD · 새로고침 · 모달 상태
│   └── useWorkspaceTreeActions  → 트리 노드 이동/삭제/이름 변경
│   └── useSharedConversationActions → 공유 대화 Import · 새로고침
└── useGoogleDriveSync     → Google Drive 전체 동기화 흐름
    ├── useGoogleDriveConfigState → 설정 모달 폼 상태
    └── useGoogleDrivePreferencesState → 자동 동기화 인터벌 로컬 설정
```

---

## 8. 파일 크기 현황

### ⚠️ 300줄 초과 파일 (리팩토링 대상)

| 파일 | 줄 수 | 비고 |
|------|-------|------|
| `googleDriveSyncService.ts` | 1,049 | Main 서비스 — OAuth + Drive API |
| `main/index.ts` | 1,014 | 메인 프로세스 진입점 |
| `WorkspaceTree.tsx` | 792 | **다음 리팩토링 1순위** |
| `message.css` | 594 | 스타일시트 |
| `sourcePreviewParser.ts` | 592 | HTML 파서 |
| `MessageList.tsx` | 583 | **다음 리팩토링 2순위** |
| `workspaceTree.ts` (lib) | 577 | 트리 유틸리티 |
| `index.css` | 553 | 글로벌 스타일 |
| `workspaceTree.css` | 373 | 트리 스타일 |

### ✅ 300줄 이하로 관리 중인 주요 파일

| 파일 | 줄 수 |
|------|-------|
| `AppContent.tsx` | 213 |
| `useGoogleDriveSync.ts` | 293 |
| `useWorkspaceTreeActions.ts` | 245 |
| `WorkspaceModals.tsx` | 206 |
| `MarkdownCodeBlock.tsx` | 295 |
| `ChatGptAutomationView.ts` | 300 |

---

## 9. 기술적 특성

### 빌드 구성
- **Webpack** 기반 (`webpack.main.config.ts`, `webpack.renderer.config.ts`)
- `fork-ts-checker-webpack-plugin`으로 타입 체크
- `@vercel/webpack-asset-relocator-loader`로 네이티브 모듈 처리
- ESLint (`@typescript-eslint`)

### 패턴
- **Strategy 패턴**: 공유 대화 새로고침 (`DirectShared…` vs `ChatGptShareFlow…`)
- **IPC Bridge**: `preload/index.ts`의 `contextBridge`로 Main ↔ Renderer 안전 통신
- **Custom Hooks 계층**: 상태 관리를 도메인별 훅으로 분리
- **CSS Modules 없이** 바닐라 CSS (BEM 스타일 클래스명)
- **localStorage 영속화**: 작업 공간 → JSON 직렬화

### 주요 외부 의존성
| 패키지 | 용도 |
|--------|------|
| `react-markdown` + `remark-gfm` | 마크다운 렌더링 |
| `react-syntax-highlighter` | 코드 블록 하이라이트 |
| `mermaid` | 다이어그램 렌더링 (백그라운드 큐) |
| `electron` 40.8.0 | 데스크톱 셸 |

---

## 10. 다음 리팩토링 로드맵

1. **`WorkspaceTree.tsx` 분해** (792줄)
   - `FolderRow` / `ConversationLeaf` / `DragState` / `DropTarget` 단위 분리

2. **`MessageList.tsx` 분해** (583줄)
   - `VirtualList` / `Measurement` / `ScrollRestore` / `MessageRow` 단위 분리

3. **`main/index.ts` 분해** (1,014줄)
   - 윈도우 생성 · IPC 핸들러 등록 · 메뉴 설정 등으로 분리

4. **`googleDriveSyncService.ts` 분해** (1,049줄)
   - OAuth 모듈 / 파일 CRUD 모듈 / 동기화 로직 분리
