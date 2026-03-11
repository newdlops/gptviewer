# Java LSP 및 대화형 다중 파일 에디터 개선 핸드오프

## TL;DR
단일 텍스트 박스에 불과했던 Java 코드 블록을 **1) 완벽한 Intellisense를 지원하는 VS Code 스타일 에디터**, **2) 입출력이 가능한 대화형 터미널**, **3) 파일 추가/삭제가 보존되는 다중 파일 프로젝트**, **4) 스마트 코드 실행기(JShell 연동)**로 완전히 탈바꿈했습니다.

---

## 1. Java LSP (JDT.LS) 및 Intellisense 완벽 복구
*   **원인 파악:** `vscode` API를 모킹(`vscode-mock.ts`)한 환경에서는 `monaco-languageclient`가 에디터의 파일 열림(`didOpen`)과 변경(`didChange`)을 서버에 자동으로 전송하지 못해 호버나 자동완성이 작동하지 않았음.
*   **해결:**
    *   에디터에서 이벤트가 발생할 때마다 강제로 파일 텍스트와 상태를 쏘아주는 **수동 브릿징 로직(`sendLspRequest`)**을 `MarkdownJavaBlock.tsx`에 원상 복구.
    *   `vscode-mock.ts`에 시맨틱 토큰(Semantic Tokens) 해석을 위한 `SemanticTokensLegend`, `SemanticTokensBuilder` 등의 필수 클래스를 추가 보강.

## 2. VS Code 스타일 커스텀 테마 & 구문 하이라이팅
*   **Monarch Tokenizer 확장:** Monaco Editor의 기본 Java 구문 분석기는 단어들을 단순 `identifier`로 뭉뚱그림. 이를 개선하여 대문자로 시작하는 단어(클래스), 소문자+괄호(메서드), `@`어노테이션, 상수 등을 세밀하게 쪼개는 정규식을 에디터 로드 전(`beforeMount`)에 주입함.
*   **VS Code 테마 적용:** `vscode-dark-custom`, `vscode-light-custom` 테마를 직접 정의하여 VS Code와 거의 동일한 다채로운 색상(메서드는 노란색, 클래스는 청록색 등)을 적용.
*   **호버 툴팁 개선:** `message.css` 전역 스타일의 격리(`content-visibility`, `overflow`)를 해제하여 호버 창이 에디터 영역 밖으로 시원하게 튀어나오게 하고, 둥근 모서리와 블러 효과를 주어 시인성을 높임.

## 3. 스마트 대화형 실행 환경 (Interactive Execution & JShell)
*   **양방향 IPC 브릿지:** 기존의 단순 `exec` 기반 일괄 실행에서 벗어나 `spawn`을 사용하여 `stdin`, `stdout`, `stderr`를 실시간으로 주고받는 스트리밍 구조(`start-interactive`, `send-input` 등)를 메인과 렌더러에 뚫음.
*   **터미널 UI:** 에디터 하단에 `System.in` 입력을 받을 수 있는 커스텀 콘솔 프롬프트를 구현.
*   **스크롤 버그 픽스:** 로그가 찍힐 때 전체 화면이 아래로 끌려 내려가던 현상(`scrollIntoView`)을 제거하고, 콘솔 컨테이너 내부의 `scrollTop`만 제어하도록 수정.
*   **스마트 코드 판별기 (`javaExecutionAnalyzer.ts`):** 
    *   **클래스 형태:** `javac` -> `java` 일반 실행
    *   **메인 메서드만:** `class Main` 래퍼 씌워서 실행 (Java 21 JEP 445 대비)
    *   **스니펫/단순 함수:** 무겁게 컴파일하지 않고 **`jshell -q`**를 띄워 백그라운드에서 실시간 코드를 평가(Evaluate)하고 결과를 넘기도록 지능화함.
*   **버전 충돌 에러(`release version 21 not supported`) 해결:** 시스템 환경변수를 타지 않고, JDT.LS에 쓰던 "내장 JDK 또는 Homebrew Java 21 절대경로"를 `javac`와 `jshell` 호출 시에도 강제 적용.

## 4. 다중 파일(Multi-File) 프로젝트 & 자동 저장 캐시 시스템
*   **백엔드 파일 API (`javaLspService.ts`):** 임시 프로젝트 폴더(`src/` 등)에 파일 및 폴더 생성, 삭제, 이름 변경, 스냅샷 추출 API 구현.
*   **탐색기(Explorer) UI 확장:** 에디터 좌측 패널에 `📄+`(새 파일), `📁+`(새 폴더), `🗑`(삭제) 액션 버튼과 인라인 텍스트 입력창 추가. (`.java` 생성 시 기본 클래스 템플릿 자동 삽입)
*   **프로젝트 캐시(`customJavaProjectCache.ts`):** 기존의 단일 파일 텍스트 캐시를 넘어서, 임시 폴더 내의 모든 트리를 직렬화하여 로컬 스토리지에 자동 저장. 새로고침해도 추가했던 파일들이 그대로 복원됨.
*   **원본 복원:** 프로젝트를 망쳤을 때, 클릭 한 번으로 모든 추가/변경 파일을 날리고 최초의 채팅 원본 코드로 돌아가는 "초기화" 버튼 도입.

## 5. 부수적 화면 버그 해결 (Mermaid 등)
*   **코드 블록 가려짐/짤림:** `message.css`의 최상위 `.code-block`에 걸려있던 가혹한 최적화 옵션(`overflow: hidden`, `content-visibility: auto`)을 `visible`로 해제. 
*   **가변 높이 에디터:** 텍스트 라인 수(`lineCount`)에 비례해 에디터의 `minHeight`가 동적으로 늘어나도록 계산식을 적용하여, 편집 창 내에서 스크롤로 인해 마지막 줄이나 하단 UI가 짤려 보이지 않던 고질적 문제 해결.
