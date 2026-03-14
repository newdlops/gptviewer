# Shared Refresh Module

ChatGPT 대화 데이터를 갱신(Refresh)하거나 새로 가져올 때 사용되는 공통 인터페이스와 에러 코드를 정의합니다.

## 주요 구성 요소
- **데이터 모델**: `SharedConversationMessage`, `SharedConversationSource` 등 대화의 핵심 데이터 구조를 정의합니다.
- **통신 규격**: 새로고침 요청(`SharedConversationRefreshRequest`)과 결과(`SharedConversationRefreshResult`) 타입을 통해 메인과 렌더러 간의 규격을 맞춥니다.
- **에러 핸들링**: `SharedConversationRefreshErrorCode`를 통해 발생 가능한 오류 상황을 명세합니다.
