# GPTViewer Context

## Current focus
- Shared conversation URL import still fails to include new Deep Research content.
- Primary files:
  - `src/main/index.ts`
  - `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationImportScripts.ts`
  - `src/main/services/sharedConversationRefresh/chatgpt/chatGptConversationNetworkMonitor.ts`
- `src/main/parsers/chatGptConversationHtmlParser.ts`

## Proven by latest logs
- Static shared parse works: `baseParsed=yes`, `baseMessages=236`.
- Rendered shared page merge is richer than both static and plain rendered:
  - `rendered-share-merge-base] static=236 rendered=231 replacements=10`
  - previous compare showed `mergedAssistantChars` > `renderedAssistantChars` but selection still chose `rendered`.
- Shared-page network monitor still finds no useful Deep Research payloads.
- Standalone deep research iframe URL still opens only a shell page and produces no useful network records.
- A recurring bug path existed where `deepResearchIframe` became `about:blank`.

## Latest fixes
- `renderedEnhancement.deepResearchIframeSrc` is now only accepted if it is a meaningful deep-research connector URL.
- If an assistant block contains an iframe but iframe DOM extraction fails, snapshot extraction now prefers the whole block HTML instead of falling back immediately to narrow `.markdown/.prose` candidates.
- Shared import base selection now prefers `mergedRenderedBase` over plain `rendered` when merged assistant text is meaningfully richer.
- `src/main/parsers/chatGptConversationNetworkParser.ts` now supports new Deep Research widget-state JSON:
  - detects strings shaped like `The latest state of the widget is: {...}`
  - parses embedded widget JSON
  - extracts `report_message.content.parts`
  - promotes that assistant report to a conversation candidate when `mapping/current_node` is absent
- Original-link direct import now merges Deep Research `report_message` back into the main mapping conversation instead of choosing either `mapping/current_node` or `report_message` by score:
  - if a widget-state placeholder assistant message exists, it is replaced with the final report body
  - otherwise the final report is appended without discarding the rest of the conversation
- `a.json` confirmed a second Deep Research JSON pattern in original-link imports:
  - assistant text may contain raw `/Deep Research App/implicit_link::connector_openai_deep_research/...` payload JSON
  - this is internal widget control data, not user-visible report content
  - parser now drops that payload text and lets `widget_state.report_message.content.parts` provide the actual Deep Research body
- `a.json` also confirmed a third original-link pattern:
  - Deep Research state can arrive as a plain JSON string field like `widget_state: "{...report_message...}"`
  - parser now recursively unwraps raw JSON-string `widget_state` / `venus_widget_state` values
  - mapping assistant messages that contain raw widget-state JSON are now replaced by the final `report_message` body during merge
- Fixed a regression in original-link direct import:
  - `DirectChatConversationImportStrategy.ts` was returning widget/report-only conversation too early from backend `conversation/<id>` body
  - this discarded the rest of the original mapping conversation
  - widget/report parsing is now fallback-only; the normal JSON parser runs first so mapping + report merge can preserve the full conversation
- Deep Research report merge is now multi-report aware:
  - parser no longer picks only the single highest-scoring `report_message`
  - it collects all unique `report_message` candidates from widget-state payloads
  - replaces widget/deep-research placeholder assistant messages in mapping order, one-to-one
  - if mapping is absent, multiple report messages are preserved in order instead of collapsing to one

## Current hypothesis
- The best remaining source is likely the rendered assistant block HTML already present in the shared page, not the standalone deep-research iframe shell.
- Need to re-run the same shared URL import and confirm the new selection branch now reports `choose=merged`.

## Next check after restart
Look for these logs:
- `shared-deep-research:rendered-share-compare`
- `shared-deep-research:rendered-share-merge-source`
- `shared-deep-research:merge`

## Validation
- Run after edits:
  - `npx tsc --noEmit`
  - `npm run lint`
