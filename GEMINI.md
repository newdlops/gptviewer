# Gemini Project Context

## IntelliJ MCP Configuration

- 이 프로젝트에는 여러 개의 프로젝트가 동시에 열려 있을 수 있는 환경입니다.
- **필수 지침:** `IntelliJ MCP` 도구를 호출할 때는 반드시 `projectPath` 파라미터에 아래의 경로를 명시적으로 포함해야 합니다.
  - **Project Path:** `/Users/ki-younglee/Desktop/project/gptviewer`
- **안정성 확보:** 
  - IntelliJ가 백그라운드에 있다가 복귀할 때 일시적으로 MCP 응답이 지연되거나 세션 오류가 발생할 수 있습니다.
  - 만약 "No exact project is specified" 또는 "Timeout" 오류가 발생하면, 즉시 다시 시도(Retry)하거나 `get_repositories` 등의 가벼운 도구로 세션을 재활성화한 후 원래 작업을 수행하십시오.
  - 도구 호출 시 항상 `projectPath`를 명시함으로써, IDE가 어떤 프로젝트 컨텍스트인지 즉각 인식하도록 강제합니다.

