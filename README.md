# GPT Viewer

ChatGPT 대화 데이터를 단순한 텍스트 이상으로 해석하여, **정밀한 리포트 복원**과 **대화형 개발 환경**을 제공하는 고성능 Electron 기반 데스크톱 워크스페이스입니다. 브라우저 네트워크 로그 분석을 통해 숨겨진 데이터를 추출하고, 코드 실행 및 목차 관리를 통해 대화 내역을 체계적인 지식 자산으로 변환합니다.

## 🌟 차별화된 핵심 기능

### 1. 정밀 프로토콜 해석 및 대화 복원 (High-Fidelity Reconstitution)
단순한 텍스트 크롤링이 아닌, ChatGPT의 내부 통신 프로토콜을 직접 해석합니다.
- **RSC & SSE 완벽 대응**: React Server Components(RSC) 바이너리 스트림과 Server-Sent Events(SSE) 델타 패치를 분석하여 원본 객체 구조를 100% 복원합니다.
- **Deep Research 리포트 엔진**: OpenAI Deep Research의 복잡한 추론(Reasoning) 과정과 위젯 상태를 역추적하여 정밀 리포트를 재구성합니다.
- **메시지 체인 추적**: 대화 리플레이로 발생하는 트리 구조에서 사용자가 최종적으로 선택한 경로를 정확히 식별합니다.

### 2. 대화형 Java 개발 환경 (Integrated Java Playground)
대화 중 등장한 Java 코드를 즉시 실행하고 분석할 수 있는 IDE급 기능을 제공합니다.
- **내장 JDTLS (Eclipse LSP)**: Monaco Editor와 연동된 실시간 문법 검사 및 지능형 자동완성을 지원합니다.
- **지능형 실행 전략**: 코드의 형태에 따라 일반 실행, 클래스 래핑, 또는 **JShell** 기반의 인터랙티브 평가 모드를 자동으로 선택합니다.
- **다중 파일 프로젝트**: 대화 중 생성된 코드를 기반으로 가상의 프로젝트를 구축하고 파일/폴더를 자유롭게 추가 및 수정할 수 있습니다.

### 3. 고성능 지능형 가상화 엔진 (Precision Virtualization)
- **이분 탐색 기반 렌더링**: 수천 개의 메시지도 렌더링 부하 없이 부드럽게 스크롤합니다.
- **동적 높이 보정 및 스크롤 앵커링**: 미디어나 코드 블록 확장 시 현재 시야(View)를 픽셀 단위로 고정합니다.
- **지능형 자동 추적 (Smart Auto-Bottom)**: 스트리밍 중 바닥을 추적하되, 사용자의 수동 조작을 감지하면 즉시 추적을 중단합니다.

### 4. 계층적 워크스페이스 및 동기화
- **트리 기반 폴더 구조**: 대화를 폴더별로 조직화하고 커스텀 정렬 상태를 유지합니다.
- **Google Drive 백업**: 작업 공간 스냅샷을 클라우드에 안전하게 저장하고 복원합니다.

## ⚙️ 설치 및 시작하기

### 1. 사전 요구 사항
- **Node.js**: >= 24.13.1 (npm >= 11.8.0)
- **Java**: **JDK 21** 이상 (Java LSP 및 코드 실행 기능을 위해 필수)
  - macOS (Homebrew 권장): `brew install openjdk@21`
  - Windows/Linux: JAVA_HOME 환경변수가 JDK 21 이상을 가리켜야 합니다.

### 2. 설치
```bash
# 저장소 복제
git clone https://github.com/your-repo/gptviewer.git
cd gptviewer

# 의존성 설치 (내부적으로 preinstall 스크립트가 실행됩니다)
npm install
```

### 3. 환경 변수 설정 (선택 사항)
Google Drive 동기화 기능을 사용하려면 다음 중 한 가지 방법으로 환경 변수를 설정해야 합니다.

**방법 A: 클라이언트 ID 직접 지정**
```bash
export GOOGLE_OAUTH_CLIENT_ID="your-client-id"
export GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret" # 선택 사항
```

**방법 B: Google OAuth JSON 파일 경로 지정**
```bash
export GOOGLE_OAUTH_DESKTOP_CREDENTIALS_PATH="/absolute/path/to/credentials.json"
```

### 4. 실행 및 빌드
```bash
# 개발 모드 실행
npm run dev

# 앱 패키징
npm run package

# 설치 파일 생성 (OS별 실행 파일)
npm run make
```

## 📂 프로젝트 주요 구조

- `src/main/parsers/chatgpt`: 리팩토링된 고성능 RSC/SSE/JSON 파서 모듈
- `src/main/services`: Java LSP(JDTLS) 및 실행 분석기 서비스
- `src/renderer/features/messages`: 가상화 리스트 및 마크다운 렌더링 엔진
- `src/shared/sync`: 계층적 워크스페이스 스냅샷 및 동기화 스키마
- `resources/bin/jdtls`: 내장 Java Language Server 바이너리
