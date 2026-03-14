# Shared Import Module

외부 프로젝트나 대화 URL로부터 데이터를 일괄 수집하거나 가져오는 과정에서 사용되는 공통 타입을 정의합니다.

## 주요 구성 요소
- **진행 상태**: `ProjectConversationImportProgress`를 통해 수집 및 임포트 단계를 모니터링합니다.
- **결과 구조**: `ProjectConversationImportResult`를 통해 성공한 대화 목록과 실패 사유를 관리합니다.
- **프로젝트 맵**: `ProjectConversationLink`를 통해 수집된 대화 링크와 제목 쌍을 정의합니다.
