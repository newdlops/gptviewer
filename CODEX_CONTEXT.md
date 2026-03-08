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
- `src/renderer/features/messages/components/MarkdownCodeSourcePanel.tsx`
- `src/renderer/features/messages/lib/useMarkdownCodeBlockRendering.ts`
- `src/renderer/features/messages/lib/markdownCodeBlockState.ts`
- `src/renderer/features/messages/lib/markdownCodeBlockUtils.ts`
- `src/renderer/features/messages/lib/mermaidLayout.ts`
- `src/renderer/features/messages/lib/mermaidVariants.ts`
- `src/renderer/features/messages/lib/useZoomableDiagramViewport.ts`
- `src/renderer/features/messages/components/MessageList.tsx`
- `src/renderer/features/messages/styles/message.css`

### Current State
- `MarkdownCodeBlock.tsx` was refactored and slimmed down into a UI-focused component.
- Main split:
  - component shell: `components/MarkdownCodeBlock.tsx`
  - source panel UI: `components/MarkdownCodeSourcePanel.tsx`
  - render/cache/effect state: `lib/useMarkdownCodeBlockRendering.ts`
  - stores/types: `lib/markdownCodeBlockState.ts`
  - markdown/code helpers: `lib/markdownCodeBlockUtils.ts`
  - mermaid SVG sizing/candidate selection: `lib/mermaidLayout.ts`
  - mermaid transform/wrapping logic: `lib/mermaidVariants.ts`
- Current size snapshot after refactor:
  - `MarkdownCodeBlock.tsx`: 265 lines
  - `useMarkdownCodeBlockRendering.ts`: 394 lines
  - `mermaidVariants.ts`: 1102 lines
- Next cleanup candidate inside the markdown/code-block area is `mermaidVariants.ts` if further modularization is needed.
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
- Layout forcing for wrapped subgraphs was strengthened again:
  - both the global-subgraph DAG wrapper and the local subgraph-chain wrapper now reintroduce an explicit outer wrapper subgraph with `direction TB`
  - row subgraphs inside that wrapper are blank-labeled and transparent, while the outer wrapper keeps the original subgraph title
  - row bodies now prefer inline chain syntax (`A[[...]] --> B[[...]] --> C[[...]]`) when possible, instead of separate definition + edge lines
  - goal: force Mermaid to honor multi-row stacking more aggressively while still preserving the original titled group semantics
- Layout forcing was changed again to follow a stronger Mermaid-friendly pattern:
  - wrapped subgraph rows are now emitted as sibling `subgraph` blocks instead of being nested in an outer wrapper
  - the original subgraph title is kept on the first emitted row; later rows are blank-labeled
  - row stacking is now forced with invisible spacer nodes and `~~~` links between sibling row subgraphs
  - this change was based on a user-provided working Mermaid pattern where `subgraph SG1`, `spacer`, `subgraph SG2`, and `SG1 ~~~ spacer ~~~ SG2` reliably produced the desired stacked layout
- Mermaid wrap strategy was adjusted again after user feedback:
  - original titled root subgraph is now preserved again via an outer wrapper subgraph with `direction TB`
  - inside that wrapper, row subgraphs are stacked using invisible spacer nodes plus `~~~` links
  - actual semantic row-boundary edges (for example `D --> E`) are also re-added so relationships do not disappear
  - wrapped rendering no longer evaluates only one transformed variant; it now renders multiple wrapped candidates (default, 2-row, 3-row, 4-row, 5-row) and picks the narrowest usable one against the available code-block width
  - goal: resolve overflow more reliably while keeping visible relationships and preserving the original subgraph grouping semantics
- Mermaid wrap strategy was adjusted again after clarified user intent:
  - the outer wrapper subgraph was removed again because it caused Mermaid to collapse rows back into a tall pillar
  - root-level sibling subgraphs are now emitted once per wrapped row (`subgraph-child`, `subgraph-child`, ...)
  - the first root-level row keeps the original subgraph title; later rows are blank-labeled
  - invisible spacer nodes plus `~~~` links are still used to encourage stacked layout
  - actual semantic row-boundary edges (for example `D --> E`) are preserved alongside spacer links
- `맞춤`, `자동조절`, and `코드 보기` / `렌더링` now share the same action-button styling in the code block header.
- Mermaid error handling / manual fix workflow was added:
  - render path is now classified as `original`, `wrapper`, or `custom`
  - wrapper failures are surfaced as warnings when original render still succeeds
  - original/custom failures are surfaced as blocking errors
  - code-view header now shows an issue badge (`원본 오류`, `변환 경고`, `변환 오류`, `사용자 오류`)
  - code view now always exposes:
    - original Mermaid
    - transformed Mermaid when a wrapper/generated source exists
    - editable `사용자 직접 수정 Mermaid`
  - custom Mermaid source is persisted in `customMermaidSourceStore` by `persistenceKey`
  - saving custom Mermaid switches rendering to the user source and caches it for later renders
  - clearing custom Mermaid returns the block to original/transformed rendering
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

## Latest Mermaid Layout Note
- Mermaid wrapped-subgraph layout is currently being tuned in `src/renderer/features/messages/components/MarkdownCodeBlock.tsx`.
- Current implementation center is `src/renderer/features/messages/lib/mermaidVariants.ts`.
- `mermaidVariants.ts` was split and is now a barrel file.
- Current file split:
  - `src/renderer/features/messages/lib/mermaidVariantShared.ts`
  - `src/renderer/features/messages/lib/mermaidTopLevelVariants.ts`
  - `src/renderer/features/messages/lib/mermaidWrappedVariants.ts`
  - `src/renderer/features/messages/lib/mermaidVariants.ts` (re-export only)
- `mermaidWrappedVariants.ts` was further split to reduce size:
  - `src/renderer/features/messages/lib/mermaidWrappedGraph.ts`
  - `src/renderer/features/messages/lib/mermaidWrappedGlobalSubgraphs.ts`
  - `src/renderer/features/messages/lib/mermaidWrappedLinearSubgraphs.ts`
  - `src/renderer/features/messages/lib/mermaidWrappedVariants.ts` now keeps only top-level variant builders and simple-chain wrapping
- Current active rules:
  - wrapped candidates are generated as explicit `2/3/4/5-row` variants
  - candidate selection prefers lower row counts first, then wider non-overflowing layouts
  - wrapped variants are built from the original Mermaid source, not from a pre-verticalized source
  - `top-level subgraph` variants (`independent` / `compact`) now rebuild each group as:
    - visible root subgraph
    - nested child subgraph with `direction LR`
  - wrapped row variants also use the same nested `root -> child(LR)` structure
  - root groups are connected with invisible spacer links (`~~~`) to force row-level placement
  - row-to-row semantic edges are preserved directly between boundary nodes
- Current visual goal:
  - root-level groups should stack as rows
  - child subgraph internals should remain horizontal (`LR`)
  - overflow should be reduced without fragmenting diagrams into unnecessary many rows
- Latest confirmed change:
  - `top-level subgraph` and wrapped-row builders were unified to the same nested structure
  - root groups are no longer hidden

## Latest Code Editor Note
- The editable `사용자 직접 수정 Mermaid` panel now uses an editor-like layout in:
  - `src/renderer/features/messages/components/MarkdownCodeSourcePanel.tsx`
  - `src/renderer/features/messages/styles/message.css`
- Current editable mode behavior:
  - line-number gutter on the left
  - syntax-highlighted background layer using existing `react-syntax-highlighter`
  - transparent textarea input layer on top
  - scroll syncing between textarea, gutter, and highlight layer
  - gutter now uses a single `pre` block with the same font-size/line-height as the editor input, to reduce line-spacing mismatch
- Validation passed after this change:
  - `npx tsc --noEmit`
  - `npm run lint`

## Latest Custom Mermaid Cache / Preview Note
- User-requested Mermaid custom editing is now partially completed.
- Added URL-scoped custom Mermaid cache:
  - `src/renderer/features/messages/lib/customMermaidSourceCache.ts`
- Added live draft preview hook:
  - `src/renderer/features/messages/lib/useMermaidDraftPreview.ts`
- `useMarkdownCodeBlockRendering.ts` now:
  - derives a shared cache key from `chatUrl || sourceUrl || conversation.id` plus original Mermaid source
  - restores saved custom Mermaid from localStorage-backed cache
  - saves and clears custom Mermaid in both in-memory state and shared cache
- `MessageList.tsx` now passes `sharedCacheScope` into `MarkdownCodeBlock`
- `MarkdownCodeBlock.tsx` now shows a right-side live preview for editable Mermaid source
- `MarkdownCodeSourcePanel.tsx` now supports:
  - optional `preview` content
  - side-by-side editable editor + preview layout
  - `code-block__source-editor` class so editable overflow measurement can target the editor pane
- `message.css` now includes preview pane/editor layout styles
- Resulting behavior:
  - user-edited Mermaid can be saved to cache
  - same URL-scoped Mermaid can be restored on later refresh/reload
  - editable Mermaid panel shows live preview on the right while typing
- Validation passed after this change:
  - `npx tsc --noEmit`
  - `npm run lint`

## Latest Workspace Tree Sort Note
- Folder-level title sort toggle was added to the workspace tree.
- Scope:
  - per-folder tri-state view mode: `none -> asc -> desc -> none`
  - applied at render time only, so stored child order is preserved when sort is off
  - persisted on folder nodes via `sortMode`
- Main files:
  - `src/renderer/types/chat.ts`
  - `src/shared/sync/workspaceSnapshot.ts`
  - `src/renderer/features/conversations/lib/workspaceSnapshot.ts`
  - `src/renderer/features/conversations/lib/workspaceTree.ts`
  - `src/renderer/features/app/hooks/useWorkspaceTreeActions.ts`
  - `src/renderer/features/conversations/components/WorkspaceTree.tsx`
  - `src/renderer/features/app/components/WorkspaceSidebar.tsx`
  - `src/renderer/AppContent.tsx`
  - `src/renderer/features/conversations/styles/workspaceTree.css`
- UI:
  - folder action button cycles sort mode
  - active sort button gets highlighted
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run lint`

## Latest Conversation Smart Scroll Note
- Conversation stream now has a section-jump rail beside the scrollbar.
- Implemented in:
  - `src/renderer/features/messages/lib/messageSections.ts`
  - `src/renderer/features/messages/components/MessageList.tsx`
  - `src/renderer/features/messages/styles/message.css`
- Current behavior:
  - assistant messages are summarized into section labels
  - section markers are positioned proportionally against the scrollable range
  - hover shows a tooltip with the extracted section label
  - click scrolls directly to that section start
  - current section marker is highlighted based on current scroll position
- Notes:
  - labels prefer markdown headings, then fall back to the first cleaned sentence
  - duplicate adjacent labels are skipped
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run lint`

## Latest Smart Scroll Overlay Note
- The section rail no longer lives inside the scrolling content.
- `MessageList` now uses a non-scrolling wrapper shell:
  - `src/renderer/features/messages/components/MessageList.tsx`
  - `src/renderer/features/messages/styles/message.css`
- Current behavior:
  - section anchors float on the right as an overlay
  - the rail stays visible while content scrolls
  - the rail is slightly hidden/off-edge until hover/focus
  - hover tooltip is now a horizontal floating pill beside the rail
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run lint`

## Latest Smart Scroll Hover Performance Note
- The section rail reveal no longer uses per-mousemove React state.
- `MessageList` now uses:
  - an invisible right-edge trigger zone
  - CSS sibling hover/focus rules to reveal the rail
  - CSS pseudo-element tooltips on markers via `data-label`
- This was done to reduce stutter when the cursor passes near anchors while scrolling.
- Main files:
  - `src/renderer/features/messages/components/MessageList.tsx`
  - `src/renderer/features/messages/styles/message.css`
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run lint`

## Latest Smart Scroll Proximity Note
- The section rail no longer activates across the whole right edge.
- `MessageList` now toggles rail visibility only when:
  - the cursor is near the right edge, and
  - the cursor is close to an actual section marker vertically
- Implementation uses DOM class toggling via refs + `requestAnimationFrame`, not React hover state.
- Main files:
  - `src/renderer/features/messages/components/MessageList.tsx`
  - `src/renderer/features/messages/styles/message.css`
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run lint`

## Latest Smart Scroll Marker Stability Note
- Section markers no longer change size or shift position on hover.
- Hover/active feedback is now color + halo only, to reduce jitter near the rail.
- Main file:
  - `src/renderer/features/messages/styles/message.css`
- Validation passed:
  - `npm run lint`

## Latest Smart Scroll Rail Stability Note
- The section rail container itself no longer slides horizontally on proximity/hover.
- Removed the rail-level `translateX(...)` reveal animation so the rail stays in a fixed position.
- Only opacity now changes when the rail becomes active.
- Main file:
  - `src/renderer/features/messages/styles/message.css`
