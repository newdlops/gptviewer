# Codex Context

Updated: 2026-03-08

## Project
- Stack: Electron Forge + React + TypeScript
- Purpose: ChatGPT conversation viewer with workspace tree, project import/sync, Google Drive sync, shared conversation import/refresh

## Working Rules
- Follow `AGENTS.md` first.
- Keep `AppContent` slim.
- Prefer touched files under 300 lines when practical.
- If more structure cleanup is needed later, the main refactor targets are still:
  - `src/renderer/features/conversations/components/WorkspaceTree.tsx`
  - `src/renderer/features/messages/components/MessageList.tsx`

## Current Priority A: Mermaid / Code Block Viewer Performance

### Key Files
- `src/renderer/features/messages/components/MarkdownCodeBlock.tsx`
- `src/renderer/features/messages/lib/useZoomableDiagramViewport.ts`
- `src/renderer/features/messages/components/MessageList.tsx`
- `src/renderer/features/messages/styles/message.css`

### Current State
- Mermaid rendered blocks support:
  - zoom in/out
  - fit/reset
  - pan/drag
  - resizable outer render shell
  - explicit `자동조절` action for complex mermaid diagrams
- Viewport logic is ref/DOM-based, not React-state-per-frame.
- Per-block viewport size and transform persist by `persistenceKey`.
- The zoomable viewport now measures rendered SVG text sizes. `맞춤` means geometric fit, while `자동조절` explicitly enlarges the render shell and recenters the diagram so mermaid text aims to match surrounding body font size even if panning becomes necessary.
- `자동조절` is now the default behavior after a rendered mermaid/svg block finishes drawing. It runs once per rendered content signature and no longer requires a manual click first.
- The readable-shell expansion cap was raised substantially. `자동조절` can now grow the render shell far beyond viewport size (bounded by large fixed caps) so very wide/complex mermaid diagrams can preserve readable text instead of being forced into tiny fit-to-screen rendering.
- Mermaid readable-size detection now also inspects `foreignObject`/HTML-based label nodes, not just SVG `<text>` nodes, and auto-adjust performs a second measurement pass after shell expansion. This was added because some Mermaid layouts still rendered tiny text even though the first-pass text-size ratio looked correct.
- Auto-adjust no longer expands Mermaid viewport width beyond the parent code-block / stream width. Width is clamped to the available container width, while height may still grow aggressively to preserve readability. This prevents wide Mermaid render shells from spilling outside the conversation stream.
- Mermaid `graph/flowchart` blocks with horizontal directions (`LR`/`RL`) now try a vertical (`TB`) render variant automatically and choose it when it materially reduces excessive width. This is meant to help cases where width must stay within the stream/code-block bounds and pan-heavy horizontal layouts remain unreadable.
- Mermaid vertical fallback was strengthened again:
  - actual parent code-block width is now used as an overflow threshold during render selection
  - nested/global `direction LR|RL` statements are all rewritten to `TB` in the vertical variant, not just the first one
  - if the default SVG overflows the available width and the vertical render fits or is materially narrower, the vertical version is preferred
- Very wide linear Mermaid flowcharts now also have a wrapped fallback:
  - simple long chains like `a-->b-->c-->d...` are rewritten into multiple horizontal row subgraphs under a vertical parent layout
  - render selection now compares default, vertical, and wrapped variants against the available code-block width
  - this is intended to reduce overflow for long left-to-right chains and subgraph-heavy wide layouts
- Wrapped Mermaid fallback was strengthened again:
  - wrapped rows are now enclosed in an outer `subgraph` with `direction TB`, so Mermaid is more strongly forced into a true multi-row layout
  - shorter long chains now target 2-row layouts more often instead of splitting too aggressively into many short rows
- Wrapped Mermaid fallback now also handles simple linear chains defined *inside a subgraph block*:
  - if a subgraph contains only node definitions + a single linear edge path, it is rewritten into multiple child subgraphs stacked with `direction TB`
  - this specifically targets cases like `flowchart TD` with one wide subgraph whose internal chain would otherwise still render as a single horizontal row
- Wrapped Mermaid fallback now also handles the important case where:
  - nodes are declared inside a `subgraph`
  - but the linear DAG edges are declared *outside* that `subgraph`
  - the implementation now builds a global Mermaid edge graph, computes SCCs/Tarjan-style component order, detects single-direction DAG chains for subgraph member nodes, and rewrites the subgraph body into multiple row subgraphs under `direction TB`
  - this specifically targets wide cases like `flowchart TD` + one named subgraph + `A --> B --> C --> ...` edges emitted outside the block
- The global-subgraph DAG rewrite was strengthened again:
  - original global edge lines between subgraph member nodes are now removed from the rewritten source
  - replacement rows now include explicit intra-row edges plus hidden bridge edges between rows
  - row count is now chosen more aggressively (`~5` components per row, clamped 2..4) so medium-size chains prefer 2-row layouts instead of collapsing into a single tall column
- Wrapped subgraph rewriting was strengthened again:
  - child rows inside wrapped subgraphs now use `direction LR`
  - rows are connected through hidden bridge nodes instead of only a direct edge between row boundaries
  - wrapped selection is now chosen more aggressively when the original render overflows the available code-block width, even if the wrapped SVG is only slightly narrower
- Mermaid row splitting is now more aggressively biased toward 2-row layouts:
  - subgraph DAG wrapping and simple chain wrapping both use a shared row-count heuristic
  - up to medium graph sizes they now prefer 2 rows first, then 3 rows only for larger graphs
  - wrapped layout selection is also more aggressive: if the current render overflows and the wrapped variant is even modestly narrower, wrapped is preferred
- Global subgraph wrapping now also understands single-line chain edges like `Q1 --> Q2 --> Q3 ...`:
  - global edge collection splits long chain lines into per-edge segments
  - this allows `subgraph`-member DAG rewriting to trigger even when edges are declared as one long line outside the subgraph
  - row-to-row links now use direct node-to-node edges again instead of hidden bridge nodes, so transitions like `Q3 -> Q4` remain visibly connected in transformed Mermaid
- Global subgraph row rewriting was tightened further:
  - once a subgraph member chain is rewritten, the original source line index is fully skipped so duplicate cross-row edges like `D -> E` are not kept outside the rewritten block
  - row bodies now prefer an inline chain using labeled node definitions (for example `A[[...]] --> B[[...]] --> C[[...]]`) when the row is linear, which should make Mermaid honor horizontal row layout more reliably than separate definition + edge lines
- Subgraph wrapping was made even stronger:
  - wrapped subgraph rows are no longer nested under the original outer subgraph
  - instead, each wrapped row becomes a sibling `subgraph ... direction LR` block, with direct row-to-row edges between their boundary nodes
  - goal: prevent Mermaid from collapsing nested row subgraphs back into a single tall vertical column
- `맞춤`, `자동조절`, and `코드 보기` / `렌더링` now share the same action-button styling in the code block header.
- `MessageList` still uses virtualization.
- Mermaid/SVG blocks and fenced code blocks near the viewport are kept alive longer to reduce visible pop-in.
- Message bubbles are memoized so scroll alone does not rerender every visible block.

### Latest User-Confirmed Status
- Scroll-triggered rerendering of mermaid is fixed.

### Latest Unconfirmed Optimization
- Added a narrower keep-alive path for normal fenced code blocks to reduce slight delay during fast scroll.
- This last tweak was not re-confirmed by the user before context compression work started.

### Recent Related UX Changes
- Mermaid/SVG code blocks now expose:
  - an `overflow` badge in the header when rendered content or code content exceeds the effective viewport/content area
  - original Mermaid source plus transformed Mermaid source side-by-side in code view when an automatic layout rewrite variant is selected
  - code-view compare labels are now `원본 Mermaid` and `... 수정 Mermaid`
  - overflow is now suppressed when the viewport is at geometric fit scale, so pressing `맞춤` should clear the overflow badge unless the user zooms/pans back into an overflowing state
- Conversation header now has a `재렌더링` button. It increments a render nonce, invalidates per-block rendered Mermaid caches for the conversation, and remounts `MessageList` with the new nonce so blocks rerender as if freshly loaded.
- Stream header title now uses horizontal scroll instead of ellipsis so long titles can be fully viewed without breaking the header layout.
- Modal stacking uses actual `false -> true` open transitions, not component render order. This fixes cases like opening `로컬 비우기` from the Google Drive config modal and having the confirm modal appear behind it.
- Project import now uses the collected project list `li` title as the imported conversation title, instead of the fetched conversation title that could include date + first-message text.
- Project import list titles are now taken only from `div.text-sm.font-medium` inside each project list row. Other row text should not be used for node titles.
- Project import now allows selecting the parent folder for the newly created project folder. Sync mode still reuses the existing target folder.
- Project import now has persisted preference options:
  - helper-window worker count (default 10)
  - preferred strategy (`공유 링크 우선` vs `원본 링크 우선`)
- Project import workers now run helper windows in background mode so they do not reveal/focus-steal while batch work runs.
- Project import list collection now uses the stronger scroll stimulus again (`scrollIntoView` + wheel + `scrollTo`) and also reinstates the project-import network quiet window / settle phase. Pure stall-only collection was not sufficient for long virtualized ChatGPT project lists.
- `background` helper windows are no longer fully hidden. In `ChatGptAutomationView`, background mode now still calls `showInactive()`, so helper windows become visible without taking focus. This was done because completely hidden windows appeared to break project-list lazy loading and share-link automation in some cases.
- Background helper windows now keep the full large refresh-window size, but are positioned mostly off-screen at the bottom-right with only a small visible peek. They still use `showInactive()` and do not take focus. This is the current compromise to preserve the ChatGPT share modal layout while minimizing visual interruption.
- Background helper windows are now parked with an even smaller visible peek (`8px`) so they are almost fully hidden while still remaining alive for reuse.
- Background helper windows are now parked with an almost invisible `1px` peek at the bottom-right and `opacity=0.01`. They remain technically shown for ChatGPT UI/background behavior, but should not visibly interfere during refresh/import/sync.
- If a background helper window hits a login/challenge state, it now escalates to a visible foreground window via `presentForAttention()` so the user can complete login or human verification.
- `공유 링크 우선` project import preference was being bypassed because `SharedConversationRefreshService` fell back to `direct-chat-page` before honoring `mode: 'chatgpt-share-flow'`. The service now checks `chatgpt-share-flow` first, so the selected strategy order can actually take effect.
- Manual conversation refresh in the renderer now always forces `helperWindowMode: 'background'` if the stored refresh request does not specify one. `buildRefreshRequest(...)` also now defaults new refresh requests to background mode, so clicking refresh should no longer open a centered visible helper window unless a login/challenge escalation explicitly promotes it.
- Background helper windows are now reused as a pool instead of being destroyed after each project-import task. `ChatGptAutomationView.acquire('background')` reuses hidden idle windows, and `close()` for background mode now resets the window (`about:blank` + `hide`) and returns it to the idle pool. This keeps the number of heavy helper windows bounded by active worker concurrency instead of total processed tasks.
- Background helper windows are now reused as a pool instead of being destroyed after each project-import task. Idle background windows are no longer hidden/destroyed between tasks; they stay parked at the bottom-right and get reassigned to new URLs, which reduces the “new helper window keeps respawning” effect.
- Project import/sync and project retry flows now explicitly drain the background helper-window pool when the whole batch task finishes. During the task, windows are reused as a pool; after completion, the idle pooled windows are destroyed to release memory.
- Direct chat import now tries to capture replayable backend headers and fetch `/backend-api/conversation/<id>` before waiting for full conversation render readiness. Goal: for long original-link conversations, collect JSON as early as possible and move on without paying the full DOM-render wait unless backend JSON still fails.

## Current Priority B: Original Chat URL Direct Import / Refresh

### Key Files
- `src/main/services/sharedConversationRefresh/strategies/DirectChatConversationImportStrategy.ts`
- `src/main/services/sharedConversationRefresh/SharedConversationRefreshService.ts`
- `src/main/services/sharedConversationRefresh/chatgpt/ChatGptAutomationView.ts`
- `src/main/services/sharedConversationRefresh/chatgpt/ChatGptConversationNetworkMonitor.ts`
- `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationImportScripts.ts`
- `src/main/parsers/chatGptConversationNetworkParser.ts`
- `src/main/parsers/chatGptConversationHtmlParser.ts`

### What Is Working
- Direct import first tries `GET /backend-api/conversation/<id>`.
- If that fails, fallback paths still exist:
  - network response parsing
  - document HTML parsing
  - DOM fallback
- The parser has already been narrowed to real visible conversation messages:
  - `role === user|assistant`
  - `content_type === text`
  - `status === finished_successfully`
- Internal nodes like `thoughts`, `reasoning_recap`, `model_editable_context`, and hidden system nodes are excluded.

### Current Blocking Issue
- In the helper automation window, direct backend fetch is still returning `401`:
  - `GET /backend-api/conversation/<id>`
- Because of that, the app falls back away from the real conversation JSON that contains the original mermaid/code content.

### Important Real Runtime Diagnosis
- User provided a real successful `GET /backend-api/conversation/<id>` payload.
- That payload confirms the correct source shape is:
  - `mapping`
  - `current_node`
  - message tree containing the true conversation content
- Therefore the conceptual parse target is correct; the runtime problem is access to that JSON, not the existence of the data.

### Last Important Runtime Logs
- Direct backend attempt:
  - `status=401 ok=false url=https://chatgpt.com/backend-api/conversation/...`
- Fallback run:
  - document HTML record had `mermaidSignals=3`
  - but still `candidates=0`
  - final result was `selected: none`

### Current Interpretation
- The app is not yet successfully consuming the real conversation JSON in runtime.
- The fallback path sees mermaid-related hints in the document, but still does not recover valid conversation candidates.

### Header Replay Work Already Added
- Network monitor now captures headers from successful page-side `/backend-api/*` requests.
- Automation view exposes the captured backend headers.
- Direct import can replay captured headers when retrying `conversation/<id>`.

### Next Verification Point
- Re-run direct import and check whether header replay changes:
  - `401 -> 200`
- The next key log line to inspect is the backend replay attempt with replayed headers.

## Validation Status
- Last successful checks:
  - `npx tsc --noEmit`
  - `npm run lint`

## Immediate Continuation Guidance
- If continuing viewer work: stay focused on code-block/diagram fast-scroll responsiveness without disabling virtualization globally.
- If continuing direct-import work: prioritize making `/backend-api/conversation/<id>` succeed in the helper window before investing further in HTML fallback parsing.
- If continuing project import work:
  - preferences live in `src/renderer/features/app/lib/projectConversationImportPreferences.ts`
  - batch concurrency is no longer hardcoded in `projectConversationImportBatch.ts`
  - strategy order is selected in `projectConversationImportHelpers.ts`
  - background helper-window mode is controlled through `SharedConversationRefreshRequest.helperWindowMode` and `ChatGptAutomationView.acquire(...)`
