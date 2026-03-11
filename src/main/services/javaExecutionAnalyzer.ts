export type JavaExecutionStrategy = 'NORMAL' | 'WRAP_IN_CLASS' | 'WRAP_IN_MAIN' | 'JSHELL';

export interface JavaCodeAnalysisResult {
  strategy: JavaExecutionStrategy;
  executableCode: string;
  mainClassName: string;
}

/**
 * 주어진 Java 코드를 분석하여 최적의 실행 전략을 결정합니다.
 * 기존 LSP나 에디터의 원본 코드는 건드리지 않으며, 오직 '실행(Run)' 단계에서만 사용됩니다.
 */
export function analyzeJavaExecution(originalCode: string): JavaCodeAnalysisResult {
  const code = originalCode.trim();

  // 1. 클래스 선언이 있는지 확인 (public class, class, record 등)
  const classRegex = /(?:public\s+)?(?:abstract\s+)?(?:final\s+)?(?:class|record|interface)\s+([a-zA-Z_$][a-zA-Z\d_$]*)/;
  const classMatch = code.match(classRegex);

  // 클래스 선언이 있는 경우
  if (classMatch) {
    const className = classMatch[1];
    return {
      strategy: 'NORMAL',
      executableCode: originalCode, // 원본 그대로 실행
      mainClassName: className,
    };
  }

  // 2. 클래스는 없지만 main 메서드가 있는 경우 (Java 21 JEP 445 '이름 없는 클래스')
  // 예: void main() { ... } 또는 public static void main(String[] args) { ... }
  const mainRegex = /(?:public\s+static\s+)?void\s+main\s*\(/;
  if (mainRegex.test(code)) {
    // Java 21 프리뷰 기능으로 그대로 실행할 수도 있지만,
    // 가장 안전한 구형/신형 호환을 위해 겉에 Main 클래스를 감싸줍니다.
    const wrappedCode = `public class Main {\n${originalCode}\n}`;
    return {
      strategy: 'WRAP_IN_CLASS',
      executableCode: wrappedCode,
      mainClassName: 'Main',
    };
  }

  // 3. 클래스도 없고 main도 없지만, 다른 메서드 선언이 있는 경우
  // 예: int add(int a, int b) { return a + b; }
  const methodRegex = /(?:public|private|protected|static|final|native|synchronized|abstract|transient|\s)*[\w<>[\]]+\s+[a-zA-Z_$][a-zA-Z\d_$]*\s*\([^)]*\)\s*(?:throws\s+[a-zA-Z_$][a-zA-Z\d_$,\s]*)?\{/;
  // 코드에 중괄호 블록이 있고, 세미콜론으로만 끝나는 단순 문장(Statement)이 아닐 때 메서드로 추정
  if (methodRegex.test(code) && code.includes('{') && !code.startsWith('import ')) {
    // 메서드만 있는 경우 실행 진입점(main)이 없으므로 JShell을 사용하여 평가(Evaluate)하는 것이 가장 이상적입니다.
    return {
      strategy: 'JSHELL',
      executableCode: originalCode,
      mainClassName: '',
    };
  }

  // 4. 순수 스니펫 (단순 출력문, 변수 선언 등)
  // 예: System.out.println("Hello");
  // 이 경우도 JShell을 띄워서 인터랙티브하게 한 줄씩 먹이는 것이 가장 완벽합니다.
  return {
    strategy: 'JSHELL',
    executableCode: originalCode,
    mainClassName: '',
  };
}
