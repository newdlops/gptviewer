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

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    setMonacoInstance(monaco);
    setEditorInstance(editor);

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
    <div className="code-block" style={{ border: isDark ? '1px solid #333' : '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
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
          <button className={`code-block__action-button${isJavaRunning ? ' is-loading' : ''}`} type="button" disabled={isJavaRunning}
            onClick={async () => {
              setIsJavaRunning(true); setJavaResult(null);
              try {
                const result = await window.electronAPI?.runJavaCode(activeJavaSource);
                setJavaResult(result || { success: false, error: 'No result' });
              } catch (err: any) { setJavaResult({ success: false, error: err.message });
              } finally { setIsJavaRunning(false); }
            }}>
            {isJavaRunning ? '실행 중...' : '실행'}
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
        overflow: isJavaEditMode ? 'hidden' : 'visible'
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

        <div style={{ flexGrow: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
          <div style={{ flexGrow: 1, overflow: 'hidden' }}>
            {isJavaEditMode ? (
              <Editor
                height="100%"
                path={javaFilePath ? `file://${javaFilePath}` : undefined}
                language="java"
                theme={isDark ? 'vs-dark' : 'light'}
                value={currentFileContent}
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
                  scrollbar: { alwaysConsumeMouseWheel: false, handleMouseWheel: true }
                }}
              />
            ) : (
              <div style={{ height: 'auto', overflow: 'visible' }}>
                <MarkdownCodeSourcePanel language="java" themeMode={themeMode} title="" value={activeJavaSource} />
              </div>
            )}
          </div>

          {javaResult && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20, maxHeight: '50%', overflow: 'auto',
              backgroundColor: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              borderTop: `2px solid ${javaResult.success ? '#4caf50' : '#f44336'}`,
              padding: '12px', fontSize: '13px', fontFamily: 'monospace', color: isDark ? '#d4d4d4' : '#333',
              boxShadow: '0 -4px 10px rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontWeight: 'bold' }}>{javaResult.success ? '✓ 실행 결과' : '✗ 오류'}</span>
                <button onClick={() => setJavaResult(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>✕</button>
              </div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{javaResult.output || ''}</pre>
              {javaResult.error && <div style={{ color: '#f44336', marginTop: '4px' }}>{javaResult.error}</div>}
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
