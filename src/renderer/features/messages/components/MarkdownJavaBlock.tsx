import { useState, useMemo, useEffect, useRef } from 'react';
import type { ThemeMode } from '../../../types/chat';
import { formatCodeLanguageLabel } from '../lib/markdownCodeBlockUtils';
import { customJavaSourceStore } from '../lib/markdownCodeBlockState';
import {
  buildCustomJavaSourceCacheKey,
  clearCustomJavaSourceFromCache,
  loadCustomJavaSourceFromCache,
  saveCustomJavaSourceToCache,
} from '../lib/customJavaSourceCache';
import { MarkdownCodeSourcePanel } from './MarkdownCodeSourcePanel';
import Editor, { loader, OnMount } from '@monaco-editor/react';
import { createJavaLanguageClient } from '../lib/javaLspClient';

loader.config({ paths: { vs: '../vs' } });

type MarkdownJavaBlockProps = {
  code: string;
  persistenceKey: string;
  sharedCacheScope?: string;
  themeMode: ThemeMode;
};

export function MarkdownJavaBlock({
  code,
  persistenceKey,
  sharedCacheScope,
  themeMode,
}: MarkdownJavaBlockProps) {
  const sharedCustomJavaCacheKey = useMemo(
    () => buildCustomJavaSourceCacheKey(sharedCacheScope, code),
    [sharedCacheScope, code],
  );

  const [customJavaSource, setCustomJavaSource] = useState<string | null>(() =>
    (customJavaSourceStore.get(persistenceKey) ??
    loadCustomJavaSourceFromCache(sharedCustomJavaCacheKey)) ||
    null
  );

  const [isJavaEditMode, setIsJavaEditMode] = useState(false);
  const [monacoInstance, setMonacoInstance] = useState<any>(null);
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const [languageClientInstance, setLanguageClientInstance] = useState<any>(null);
  const [isJavaRunning, setIsJavaRunning] = useState(false);
  const [javaFilePath, setJavaFilePath] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [projectTree, setProjectTree] = useState<any[]>([]);
  const [showDrawer, setShowDrawer] = useState(true);
  const [lspStatus, setLspStatus] = useState<'idle' | 'starting' | 'connected' | 'error'>('idle');
  const [manualHeight, setManualHeight] = useState<number | null>(null);
  const [originalJavaFilePath, setOriginalJavaFilePath] = useState<string | null>(null);
  const [currentFileContent, setCurrentFileContent] = useState<string>('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [javaResult, setJavaResult] = useState<{
    error?: string;
    output?: string;
    success?: boolean;
  } | null>(null);

  // --- 추가된 대화형 터미널 상태 ---
  const [javaSessionId, setJavaSessionId] = useState<string | null>(null);
  const [javaTerminalOutput, setJavaTerminalOutput] = useState<{ type: 'out' | 'err'; text: string }[]>([]);
  const [javaTerminalInput, setJavaTerminalInput] = useState('');
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // 출력 발생 시 터미널 내부만 스크롤을 맨 아래로 이동
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [javaTerminalOutput]);

  // IPC 이벤트 리스너 등록 (백엔드에서 오는 실시간 출력 및 종료 이벤트 수신)
  useEffect(() => {
    let unsubOut: (() => void) | undefined;
    let unsubErr: (() => void) | undefined;
    let unsubExit: (() => void) | undefined;

    if (window.electronAPI && window.electronAPI.onJavaRunOutput) {
      unsubOut = window.electronAPI.onJavaRunOutput((sid, data) => {
        if (sid === javaSessionId) setJavaTerminalOutput(prev => [...prev, { type: 'out', text: data }]);
      });
      unsubErr = window.electronAPI.onJavaRunError((sid, data) => {
        if (sid === javaSessionId) setJavaTerminalOutput(prev => [...prev, { type: 'err', text: data }]);
      });
      unsubExit = window.electronAPI.onJavaRunExit((sid, code) => {
        if (sid === javaSessionId) {
          setJavaTerminalOutput(prev => [...prev, { type: 'out', text: `\n[프로세스가 코드 ${code}로 종료되었습니다.]\n` }]);
          setIsJavaRunning(false);
          setJavaSessionId(null);
        }
      });
    }

    return () => {
      unsubOut?.();
      unsubErr?.();
      unsubExit?.();
    };
  }, [javaSessionId]);
  // ------------------------------------

  const lspStatusRef = useRef(lspStatus);
  const javaFilePathRef = useRef(javaFilePath);
  const languageClientInstanceRef = useRef<any>(null);

  useEffect(() => { lspStatusRef.current = lspStatus; }, [lspStatus]);
  useEffect(() => { javaFilePathRef.current = javaFilePath; }, [javaFilePath]);

  const activeJavaSource = customJavaSource !== null ? customJavaSource : code;

  const refreshProjectTree = async (dir: string) => {
    try {
      const tree = await window.electronAPI?.getJavaProjectTree(dir);
      if (tree) setProjectTree(tree);
    } catch (e) {
      console.error('Failed to refresh project tree', e);
    }
  };

  const getLanguageFromFile = (filename: string) => {
    if (filename.endsWith('.java')) return 'java';
    if (filename.endsWith('.xml')) return 'xml';
    if (filename.endsWith('.project')) return 'xml';
    if (filename.endsWith('.classpath')) return 'xml';
    return 'plaintext';
  };

  const handleFileClick = async (node: any) => {
    if (node.type === 'directory') {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(node.path)) {
        newExpanded.delete(node.path);
      } else {
        newExpanded.add(node.path);
      }
      setExpandedPaths(newExpanded);
      return;
    }

    if (node.type === 'file' && node.path !== javaFilePath) {
      try {
        const content = await window.electronAPI?.readJavaFile(node.path);
        if (content !== undefined && content !== null) {
          setJavaFilePath(node.path);
          setCurrentFileContent(content);
          if (editorInstance) {
            const model = editorInstance.getModel();
            if (model) {
              const lang = getLanguageFromFile(node.name);
              monacoInstance.editor.setModelLanguage(model, lang);
            }
          }
        }
      } catch (e) {
        console.error('[JavaBlock] Failed to read file', e);
      }
    } else if (node.type === 'file' && node.path === javaFilePath) {
      // 이미 열려 있는 파일이지만 내용을 강제로 다시 읽어올 필요가 있는 경우 (외부 수정 등)
      console.log('[JavaBlock] File already open:', node.path);
    }
  };

  useEffect(() => {
    let languageClient: any = null;
    let isMounted = true;

    if (isJavaEditMode && monacoInstance) {
      console.log('[JavaBlock] Entering edit mode, starting Java Server...');
      setLspStatus('starting');
      (async () => {
        try {
          console.log('[JavaBlock] Calling window.electronAPI.startJavaServer...');
          const res = await window.electronAPI?.startJavaServer(activeJavaSource);
          console.log('[JavaBlock] startJavaServer Response:', res);

          if (res?.success && isMounted) {
            setJavaFilePath(res.filePath);
            setOriginalJavaFilePath(res.filePath);
            setCurrentFileContent(activeJavaSource);
            setProjectDir(res.projectDir);
            refreshProjectTree(res.projectDir);
            // src 폴더 등을 기본으로 열어주기 위해 추가
            const isWin = window.electronAPI?.platform === 'win32';
            const srcPath = res.projectDir + (isWin ? '\\src' : '/src');
            setExpandedPaths(new Set([res.projectDir, srcPath]));

            console.log(`[JavaBlock] Calling createJavaLanguageClient on port ${res.port}...`);
            const client = await createJavaLanguageClient(res.port, res.projectDir, monacoInstance);
            console.log('[JavaBlock] createJavaLanguageClient resolved:', !!client);

            if (isMounted) {
              languageClient = client;
              languageClientInstanceRef.current = client;
              setLspStatus('connected');
            } else {
              if (client && typeof client.isRunning === 'function' && client.isRunning()) {
                client.stop();
              }
            }
          } else if (res?.error) {
            console.error('[JavaBlock] Server responded with error:', res.error);
            setLspStatus('error');
          } else {
            console.warn('[JavaBlock] startJavaServer response was invalid or not mounted.');
          }
        } catch (error) {
          console.error('[JavaBlock] Exception during server start:', error);
          setLspStatus('error');
        }
      })();
    } else {
      console.log('[JavaBlock] Idle state or monacoInstance missing. EditMode:', isJavaEditMode, 'Monaco:', !!monacoInstance);
      setLspStatus('idle');
      if (!isJavaEditMode) {
        setMonacoInstance(null);
        languageClientInstanceRef.current = null;
      }
    }

    return () => {
      isMounted = false;
      if (languageClient) {
        try {
          if (typeof languageClient.isRunning === 'function' && languageClient.isRunning()) {
            languageClient.stop();
          }
        } catch (err) {
          console.warn('Error stopping client', err);
        }
      }
    };
  }, [isJavaEditMode, monacoInstance]);

  const editorHeight = useMemo(() => {
    if (manualHeight) return `${manualHeight}px`;
    const lineCount = activeJavaSource.split('\n').length;
    // 최대 높이 제한을 제거하여 코드 전체가 한 번에 보이도록 설정
    return `${Math.max(lineCount * 21 + 40, 60)}px`;
  }, [activeJavaSource, manualHeight]);

  const handleEditorWillMount = (monaco: any) => {
    // Java용 강력한 Monarch 구문 분석기 주입 (클래스, 어노테이션, 메서드 등 세분화)
    monaco.languages.setMonarchTokensProvider('java', {
      defaultToken: '',
      tokenPostfix: '.java',
      keywords: [
        'abstract', 'continue', 'for', 'new', 'switch', 'assert', 'default',
        'goto', 'package', 'synchronized', 'boolean', 'do', 'if', 'private',
        'this', 'break', 'double', 'implements', 'protected', 'throw', 'byte',
        'else', 'import', 'public', 'throws', 'case', 'enum', 'instanceof', 'return',
        'transient', 'catch', 'extends', 'int', 'short', 'try', 'char', 'final',
        'interface', 'static', 'void', 'class', 'finally', 'long', 'strictfp',
        'volatile', 'const', 'float', 'native', 'super', 'while', 'true', 'false', 'null'
      ],
      operators: [
        '=', '>', '<', '!', '~', '?', ':',
        '==', '<=', '>=', '!=', '&&', '||', '++', '--',
        '+', '-', '*', '/', '&', '|', '^', '%', '<<',
        '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=',
        '^=', '%=', '<<=', '>>=', '>>>='
      ],
      symbols: /[=><!~?:&|+\-*\/\^%]+/,
      escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
      tokenizer: {
        root: [
          // 어노테이션 (예: @Override)
          [/@[a-zA-Z_]\w*/, 'annotation'],
          // 대문자로만 이루어진 단어 (상수, 예: MAX_VALUE)
          [/[A-Z][A-Z0-9_]*\b/, 'constant'],
          // 대문자로 시작하는 단어는 클래스/인터페이스로 간주 (예: String, System)
          [/[A-Z][\w\$]*\b/, 'type.identifier'],
          // 소문자로 시작하고 뒤에 '('가 오면 메서드로 간주
          [/[a-z_$][\w\$]*(?=\s*\()/, 'function'],
          // 일반 식별자 (예: 변수)
          [/[a-zA-Z_$][\w\$]*\b/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          { include: '@whitespace' },
          [/[{}()\[\]]/, '@brackets'],
          [/[;,.]/, 'delimiter'],
          [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
          [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
          [/0[xX][0-9a-fA-F]+/, 'number.hex'],
          [/\d+/, 'number'],
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
          [/'[^\\']'/, 'string'],
          [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
          [/'/, 'string.invalid']
        ],
        whitespace: [
          [/[ \t\r\n]+/, 'white'],
          [/\/\*/, 'comment', '@comment'],
          [/\/\/.*$/, 'comment'],
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\/\*/, 'comment', '@push' ],
          ["\\*/", 'comment', '@pop'  ],
          [/[\/*]/, 'comment']
        ],
        string: [
          [/[^\\"]+/, 'string'],
          [/@escapes/, 'string.escape'],
          [/\\./, 'string.escape.invalid'],
          [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
        ],
      },
    });

    // VS Code 스타일 커스텀 테마 정의 (마운트 전)
    monaco.editor.defineTheme('vscode-dark-custom', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '569CD6' },
        { token: 'keyword.control', foreground: 'C586C0' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'type.identifier', foreground: '4EC9B0' },
        { token: 'class', foreground: '4EC9B0' },
        { token: 'class.identifier', foreground: '4EC9B0' },
        { token: 'interface', foreground: '4EC9B0' },
        { token: 'enum', foreground: '4EC9B0' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'string.escape', foreground: 'D7BA7D' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'comment.doc', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'function', foreground: 'DCDCAA' },
        { token: 'method', foreground: 'DCDCAA' },
        { token: 'variable', foreground: '9CDCFE' },
        { token: 'variable.name', foreground: '9CDCFE' },
        { token: 'parameter', foreground: '9CDCFE' },
        { token: 'property', foreground: '9CDCFE' },
        { token: 'annotation', foreground: '569CD6' },
        { token: 'constant', foreground: '4FC1FF' },
        { token: 'identifier', foreground: '9CDCFE' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'delimiter', foreground: 'D4D4D4' }
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#D4D4D4',
        'editorLineNumber.foreground': '#858585',
        'editor.selectionBackground': '#264F78',
        'editor.inactiveSelectionBackground': '#3A3D41',
      }
    });

    monaco.editor.defineTheme('vscode-light-custom', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '0000FF' },
        { token: 'keyword.control', foreground: 'AF00DB' },
        { token: 'type', foreground: '267F99' },
        { token: 'type.identifier', foreground: '267F99' },
        { token: 'class', foreground: '267F99' },
        { token: 'class.identifier', foreground: '267F99' },
        { token: 'interface', foreground: '267F99' },
        { token: 'enum', foreground: '267F99' },
        { token: 'string', foreground: 'A31515' },
        { token: 'string.escape', foreground: 'EE0000' },
        { token: 'number', foreground: '098658' },
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'comment.doc', foreground: '008000', fontStyle: 'italic' },
        { token: 'function', foreground: '795E26' },
        { token: 'method', foreground: '795E26' },
        { token: 'variable', foreground: '001080' },
        { token: 'variable.name', foreground: '001080' },
        { token: 'parameter', foreground: '001080' },
        { token: 'property', foreground: '001080' },
        { token: 'annotation', foreground: '0000FF' },
        { token: 'constant', foreground: '0070C1' },
        { token: 'identifier', foreground: '001080' },
        { token: 'operator', foreground: '000000' },
        { token: 'delimiter', foreground: '000000' }
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#000000',
        'editorLineNumber.foreground': '#237893',
        'editor.selectionBackground': '#ADD6FF',
        'editor.inactiveSelectionBackground': '#E5EBF1',
      }
    });
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    setMonacoInstance(monaco);
    setEditorInstance(editor);

    // 테마 명시적 갱신 (마운트 직후 한 번 더 쐐기)
    monaco.editor.setTheme(themeMode === 'dark' ? 'vscode-dark-custom' : 'vscode-light-custom');

    // 상세 정보 패널을 기본적으로 펼치기 위한 로컬 스토리지 강제 설정
    try {
      const storageKey = 'expandSuggestionDocs';
      if (!localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, 'true');
      }
    } catch {
      // ignore
    }

    const sendLspRequest = async (method: string, params: any): Promise<any> => {
      const currentStatus = lspStatusRef.current;
      const currentFilePath = javaFilePathRef.current;
      const currentClient = languageClientInstanceRef.current;

      if (currentStatus !== 'connected' || !currentFilePath || !currentClient) return null;

      try {
        const currentText = editor.getValue();
        const languageId = getLanguageFromFile(currentFilePath);

        // 에디터 내용이 바뀔 때마다 백엔드 파일도 동기화 (LSP 서버가 파일 시스템을 읽을 경우 대비)
        if (currentFilePath.endsWith('.java') || currentFilePath.endsWith('.xml')) {
          await window.electronAPI?.updateJavaFile(currentFilePath, currentText);
        }

        // 강제로 didOpen과 didChange를 보내서 LSP 서버가 현재 파일의 최신 텍스트를 인지하도록 함
        currentClient.sendNotification("textDocument/didOpen", {
          textDocument: { uri: `file://${currentFilePath}`, languageId, version: 1, text: currentText }
        });

        currentClient.sendNotification("textDocument/didChange", {
          textDocument: { uri: `file://${currentFilePath}`, version: Date.now() },
          contentChanges: [{ text: currentText }]
        });

        return await currentClient.sendRequest(method, params);
      } catch (e) {
        return null;
      }
    };

    const supportedLanguages = ['java', 'xml', 'plaintext'];
    const disposables: any[] = [];

    supportedLanguages.forEach(lang => {
      disposables.push(monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', ' ', '@', '('],
        provideCompletionItems: async (model: any, position: any) => {
          const result = await sendLspRequest("textDocument/completion", {
            textDocument: { uri: `file://${javaFilePathRef.current}` },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
            context: { triggerKind: 1 }
          });
          if (!result) return { suggestions: [] };
          const items = result.items || result;
          return {
            suggestions: items.map((item: any) => ({
              label: item.label,
              kind: item.kind || monaco.languages.CompletionItemKind.Function,
              insertText: item.insertText || item.label,
              detail: item.detail,
              documentation: item.documentation,
              range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column - 1, endColumn: position.column }
            }))
          };
        }
      }));

      disposables.push(monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model: any, position: any) => {
          const result = await sendLspRequest("textDocument/hover", {
            textDocument: { uri: `file://${javaFilePathRef.current}` },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });
          if (!result || !result.contents) return null;
          let contents: any[] = [];
          const raw = Array.isArray(result.contents) ? result.contents : [result.contents];
          for (const c of raw) {
            if (typeof c === 'string') contents.push({ value: c });
            else if (c?.value) contents.push({ value: c.value, isTrusted: true, supportHtml: true });
          }
          return { contents, range: result.range ? { startLineNumber: result.range.start.line + 1, startColumn: result.range.start.character + 1, endLineNumber: result.range.end.line + 1, endColumn: result.range.end.character + 1 } : undefined };
        }
      }));

      disposables.push(monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [')'],
        provideSignatureHelp: async (model: any, position: any) => {
          const result = await sendLspRequest("textDocument/signatureHelp", {
            textDocument: { uri: `file://${javaFilePathRef.current}` },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });
          if (!result || !result.signatures) return null;
          return {
            value: {
              signatures: result.signatures.map((sig: any) => ({
                label: sig.label,
                documentation: { value: typeof sig.documentation === 'string' ? sig.documentation : sig.documentation?.value || '', isTrusted: true, supportHtml: true },
                parameters: sig.parameters?.map((p: any) => ({ label: p.label, documentation: { value: typeof p.documentation === 'string' ? p.documentation : p.documentation?.value || '', isTrusted: true, supportHtml: true } })) || []
              })),
              activeSignature: result.activeSignature || 0,
              activeParameter: result.activeParameter || 0
            },
            dispose: () => {}
          };
        }
      }));
    });

    editor.onDidDispose(() => {
       disposables.forEach(d => d.dispose());
    });
  };


  const isDark = themeMode === 'dark';

  const resizerRef = useRef<HTMLDivElement>(null);
  const handleResize = (e: MouseEvent) => {
    if (resizerRef.current) {
      const containerRect = resizerRef.current.parentElement!.getBoundingClientRect();
      const newHeight = e.clientY - containerRect.top;
      if (newHeight > 150) setManualHeight(newHeight);
    }
  };
  const stopResize = () => {
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = 'default';
  };
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'ns-resize';
  };

  const renderTree = (nodes: any[], depth = 0) => (
    <div style={{ marginLeft: depth > 0 ? '12px' : '0' }}>
      {nodes.map(node => (
        <div key={node.path}>
          <div
            onClick={() => handleFileClick(node)}
            style={{
              fontSize: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center',
              color: isDark ? '#ccc' : '#333', cursor: 'pointer',
              backgroundColor: javaFilePath === node.path ? (isDark ? '#37373d' : '#e4e6f1') : 'transparent',
              borderRadius: '3px', whiteSpace: 'nowrap', userSelect: 'none'
            }}>
            <span style={{ marginRight: '6px', fontSize: '14px' }}>
              {node.type === 'directory' ? (expandedPaths.has(node.path) ? '📂' : '📁') : '📄'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
            {node.path === originalJavaFilePath && (
              <span style={{
                marginLeft: '4px', fontSize: '10px', color: '#007acc',
                fontWeight: 'bold', flexShrink: 0
              }}>(ORIGINAL)</span>
            )}
          </div>
          {node.type === 'directory' && node.children && expandedPaths.has(node.path) && renderTree(node.children, depth + 1)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="code-block" style={{ 
      border: isDark ? '1px solid #333' : '1px solid #ddd', 
      borderRadius: '8px', 
      overflow: 'visible',
      contentVisibility: 'visible',
      contain: 'none'
    }}>
      <div className="code-block__header" style={{ borderBottom: isDark ? '1px solid #333' : '1px solid #ddd' }}>
        <div className="code-block__header-meta">
          <span className="code-block__language">{formatCodeLanguageLabel('java')}</span>
          {isJavaEditMode && (
            <span style={{
              marginLeft: '8px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '10px',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              backgroundColor:
                lspStatus === 'connected' ? 'rgba(76, 175, 80, 0.15)' :
                lspStatus === 'starting' ? 'rgba(255, 193, 7, 0.15)' :
                lspStatus === 'error' ? 'rgba(244, 67, 54, 0.15)' : 'rgba(128, 128, 128, 0.15)',
              color:
                lspStatus === 'connected' ? '#4caf50' :
                lspStatus === 'starting' ? '#ffc107' :
                lspStatus === 'error' ? '#f44336' : '#888',
              border: `1px solid ${
                lspStatus === 'connected' ? 'rgba(76, 175, 80, 0.3)' :
                lspStatus === 'starting' ? 'rgba(255, 193, 7, 0.3)' :
                lspStatus === 'error' ? 'rgba(244, 67, 54, 0.3)' : 'rgba(128, 128, 128, 0.3)'
              }`
            }}>
              {lspStatus === 'connected' ? 'LSP Connected' :
               lspStatus === 'starting' ? 'LSP Starting...' :
               lspStatus === 'error' ? 'LSP Error' : 'LSP Idle'}
            </span>
          )}
        </div>
        <div className="code-block__actions">
          {isJavaEditMode && (
            <button className="code-block__action-button" type="button" onClick={() => setShowDrawer(!showDrawer)}>
              {showDrawer ? '탐색기 닫기' : '탐색기 열기'}
            </button>
          )}
          <button className={`code-block__action-button${isJavaRunning ? ' is-active' : ''}`} type="button"
            onClick={async () => {
              if (isJavaRunning && javaSessionId) {
                // 이미 실행 중이면 강제 종료
                window.electronAPI?.stopInteractiveJava(javaSessionId);
                setIsJavaRunning(false);
                setJavaSessionId(null);
                setJavaTerminalOutput(prev => [...prev, { type: 'out', text: '\n[사용자에 의해 강제 종료되었습니다.]\n' }]);
                return;
              }

              // 새 대화형 세션 시작
              const sid = Date.now().toString();
              setJavaSessionId(sid);
              setJavaTerminalOutput([]);
              setIsJavaRunning(true);
              setJavaResult(null);

              try {
                const res = await window.electronAPI?.startInteractiveJava(sid, activeJavaSource);
                if (!res?.success) {
                  setJavaTerminalOutput([{ type: 'err', text: res?.error || '프로세스를 시작하지 못했습니다.' }]);
                  setIsJavaRunning(false);
                  setJavaSessionId(null);
                }
              } catch (err: any) {
                setJavaTerminalOutput([{ type: 'err', text: err.message }]);
                setIsJavaRunning(false);
                setJavaSessionId(null);
              }
            }}>
            {isJavaRunning ? '⏹ 중지' : '▶ 실행'}
          </button>
          <button className={`code-block__action-button${isJavaEditMode ? ' is-active' : ''}`} type="button" onClick={() => setIsJavaEditMode(!isJavaEditMode)}>
            {isJavaEditMode ? '편집 종료' : '편집'}
          </button>
        </div>
      </div>

      <div style={{
        display: 'flex',
        height: isJavaEditMode ? editorHeight : 'auto',
        backgroundColor: isDark ? '#1e1e1e' : '#fff',
        position: 'relative',
        overflow: 'visible'
      }}>
        {isJavaEditMode && showDrawer && (
          <div style={{
            width: '200px', borderRight: isDark ? '1px solid #333' : '1px solid #ddd',
            padding: '10px 0', overflowY: 'auto', backgroundColor: isDark ? '#252526' : '#f3f3f3', flexShrink: 0
          }}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', padding: '0 10px 8px', color: isDark ? '#858585' : '#666', textTransform: 'uppercase' }}>EXPLORER</div>
            {renderTree(projectTree)}
          </div>
        )}

        <div style={{ flexGrow: 1, position: 'relative', overflow: 'visible', display: 'flex', flexDirection: 'column' }}>
          {isJavaEditMode && (
            <div style={{
              display: 'flex', alignItems: 'center', height: '36px',
              backgroundColor: isDark ? '#252526' : '#f3f3f3',
              borderBottom: isDark ? '1px solid #1e1e1e' : '1px solid #ddd',
              padding: '0 0'
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', height: '100%',
                padding: '0 16px',
                backgroundColor: isDark ? '#1e1e1e' : '#fff',
                fontSize: '12px', fontWeight: '500',
                color: isDark ? '#fff' : '#000',
                borderTop: '2px solid #007acc',
                borderRight: isDark ? '1px solid #333' : '1px solid #ddd',
                cursor: 'default'
              }}>
                <span style={{ marginRight: '8px' }}>☕</span>
                <span>{javaFilePath ? javaFilePath.split(/[/\\]/).pop() : 'Main.java'}</span>
                {javaFilePath && javaFilePath.includes('src') && (
                  <span style={{ marginLeft: '8px', opacity: 0.5, fontSize: '10px' }}>src/</span>
                )}
              </div>
              <div style={{ flex: 1 }}></div>
            </div>
          )}
          <div style={{ flexGrow: 1, overflow: 'visible' }}>
            {isJavaEditMode ? (
              <Editor
                height="100%"
                path={javaFilePath ? `file://${javaFilePath}` : undefined}
                language="java"
                theme={isDark ? 'vscode-dark-custom' : 'vscode-light-custom'}
                value={currentFileContent}
                beforeMount={handleEditorWillMount}
                onChange={(value) => {
                  setCurrentFileContent(value || '');
                  if (javaFilePath === originalJavaFilePath) setCustomJavaSource(value || '');
                  if (javaFilePath) window.electronAPI?.updateJavaFile(javaFilePath, value || '').then(() => refreshProjectTree(projectDir!));
                }}
                onMount={handleEditorDidMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: '"IBM Plex Mono", "Fira Code", monospace',
                  tabSize: 4,
                  automaticLayout: true,
                  quickSuggestions: true,
                  suggestOnTriggerCharacters: true,
                  renderLineHighlight: 'all',
                  suggest: { showInlineDetails: true },
                  padding: { top: 10 },
                  scrollBeyondLastLine: false,
                  scrollbar: { alwaysConsumeMouseWheel: false, handleMouseWheel: true },
                  'semanticHighlighting.enabled': true
                }}
              />
            ) : (
              <div style={{ height: 'auto', overflow: 'visible' }}>
                <MarkdownCodeSourcePanel language="java" themeMode={themeMode} title="" value={activeJavaSource} />
              </div>
            )}
          </div>

          {(javaResult || javaTerminalOutput.length > 0) && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20, maxHeight: '60%', minHeight: '120px',
              display: 'flex', flexDirection: 'column',
              backgroundColor: isDark ? 'rgba(30, 30, 30, 0.98)' : 'rgba(255, 255, 255, 0.98)',
              borderTop: `2px solid ${isJavaRunning ? '#007acc' : (javaTerminalOutput.some(o => o.type === 'err') ? '#f44336' : '#4caf50')}`,
              boxShadow: '0 -4px 12px rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', borderBottom: isDark ? '1px solid #333' : '1px solid #ddd', backgroundColor: isDark ? '#252526' : '#f3f3f3' }}>
                <span style={{ fontWeight: 'bold', fontSize: '11px', color: isDark ? '#d4d4d4' : '#333', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isJavaRunning ? '#007acc' : '#888', marginRight: '8px' }} />
                  {isJavaRunning ? '터미널 (실행 중)' : '터미널 (종료됨)'}
                </span>
                <button onClick={() => { setJavaResult(null); setJavaTerminalOutput([]); setIsJavaRunning(false); setJavaSessionId(null); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 4px' }}>✕</button>
              </div>
              
              <div ref={terminalContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '12px', fontSize: '13.5px', fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace', color: isDark ? '#d4d4d4' : '#333' }}>
                {/* Legacy static result support if any */}
                {javaResult && javaResult.output && <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{javaResult.output}</pre>}
                {javaResult && javaResult.error && <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#f44336' }}>{javaResult.error}</pre>}
                
                {/* Interactive Stream Output */}
                {javaTerminalOutput.map((out, i) => (
                  <span key={i} style={{ color: out.type === 'err' ? '#f44336' : 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{out.text}</span>
                ))}
              </div>

              {/* Interactive Input Field */}
              {isJavaRunning && (
                <div style={{ padding: '8px 12px', borderTop: isDark ? '1px solid #333' : '1px solid #ddd', display: 'flex', alignItems: 'center', backgroundColor: isDark ? '#1e1e1e' : '#fff' }}>
                  <span style={{ color: '#007acc', marginRight: '10px', fontWeight: 'bold' }}>❯</span>
                  <input
                    type="text"
                    value={javaTerminalInput}
                    onChange={(e) => setJavaTerminalInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && javaSessionId && javaTerminalInput.trim() !== '') {
                        window.electronAPI?.sendJavaInput(javaSessionId, javaTerminalInput);
                        // 에코(Echo): 사용자가 친 내용을 터미널 창에도 보여줌 (System.in은 엔터를 포함하여 받음)
                        setJavaTerminalOutput(prev => [...prev, { type: 'out', text: javaTerminalInput + '\n' }]);
                        setJavaTerminalInput('');
                      }
                    }}
                    placeholder="프로세스에 입력할 값을 적고 Enter를 누르세요..."
                    autoFocus
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      color: isDark ? '#d4d4d4' : '#333', fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace', fontSize: '13.5px'
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Resizer Handle (하단 고정) */}
        {isJavaEditMode && (
          <div
            ref={resizerRef}
            onMouseDown={startResize}
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '6px',
              cursor: 'ns-resize', backgroundColor: 'transparent', zIndex: 100,
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#007acc' : '#ccc')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          />
        )}
      </div>
    </div>
  );
}
