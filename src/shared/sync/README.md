# Shared Sync Module

애플리케이션의 상태 보존을 위한 스냅샷 구조와 클라우드(Google Drive) 동기화 관련 타입을 정의합니다.

## 주요 구성 요소
- **워크스페이스 스냅샷**: `WorkspaceSnapshot` 타입을 통해 트리 구조, 대화 목록, 확장 상태 등 전체 앱 상태를 직렬화합니다.
- **동기화 상태**: `GoogleDriveSyncStatus` 등을 통해 동기화 진행 단계와 결과를 관리합니다.
- **버전 관리**: `WORKSPACE_SNAPSHOT_SCHEMA_VERSION`을 통해 데이터 구조 변경에 대응합니다.
