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
import {
  buildCustomJavaProjectCacheKey,
  loadCustomJavaProjectFromCache,
  saveCustomJavaProjectToCache,
  clearCustomJavaProjectFromCache,
} from '../lib/customJavaProjectCache';
import { MarkdownCodeSourcePanel } from './MarkdownCodeSourcePanel';
import Editor, { loader, OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { createJavaLanguageClient } from '../lib/javaLspClient';

loader.config({ monaco });

const getLanguageFromFile = (filename: string) => {
  if (filename.endsWith('.java')) return 'java';
  if (filename.endsWith('.xml')) return 'xml';
  if (filename.endsWith('.project')) return 'xml';
  if (filename.endsWith('.classpath')) return 'xml';
  return 'plaintext';
};

const getJavaFullClassName = (filePath: string, projectDir: string) => {
  if (!filePath || !projectDir) return 'Main';
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedProjectDir = projectDir.replace(/\\/g, '/');
  const relPath = normalizedPath.replace(normalizedProjectDir, '').replace(/^\/+/, '');
  
  if (!relPath.startsWith('src/')) return relPath.split('/').pop()?.replace(/\.java$/, '') || 'Main';
  
  const pathAfterSrc = relPath.replace(/^src\//, '');
  if (!pathAfterSrc) return 'Main';
  
  // com/example/Main.java -> com.example.Main
  return pathAfterSrc.replace(/\.java$/, '').replace(/\//g, '.');
};

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
  
  // --- 추가된 디버깅 상태 ---
  const [isDebugging, setIsDebugging] = useState(false);
  const [javaDebugPort, setJavaDebugPort] = useState<number | null>(null);
  const [breakpoints, setBreakpoints] = useState<Map<string, number[]>>(new Map()); // filePath -> lines[]
  const breakpointDecorationsRef = useRef<Map<string, string[]>>(new Map()); // modelId -> decorationIds[]
  const [stackFrames, setStackFrames] = useState<any[]>([]);
  const [variables, setVariables] = useState<any[]>([]);
  const [editingVariable, setEditingVariable] = useState<{ name: string, value: string, ref: number } | null>(null);
  const [pausedLocation, setPausedLocation] = useState<{ filePath: string, lineNumber: number } | null>(null);
  const debugSocketRef = useRef<WebSocket | null>(null);
  const debugSequenceRef = useRef(1);
  const currentLineDecorationRef = useRef<string[]>([]);
  const docVersionRef = useRef(1);

  const [javaFilePath, setJavaFilePath] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [projectTree, setProjectTree] = useState<any[]>([]);
  const [showDrawer, setShowDrawer] = useState(true);
  const [drawerMode, setDrawerMode] = useState<'files' | 'debug'>('files');

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

  useEffect(() => {
    if (isDebugging) {
      setShowDrawer(true);
      setDrawerMode('debug');
    } else {
      setDrawerMode('files');
    }
  }, [isDebugging]);

  const sendDapRequest = (command: string, args?: any) => {
    if (!debugSocketRef.current || debugSocketRef.current.readyState !== WebSocket.OPEN) return;
    const seq = debugSequenceRef.current++;
    const payload = JSON.stringify({
      seq,
      type: 'request',
      command,
      arguments: args
    });
    
    // 브라우저에서 정확한 UTF-8 바이트 크기를 구함
    const byteLength = new TextEncoder().encode(payload).length;
    const message = `Content-Length: ${byteLength}\r\n\r\n${payload}`;
    
    console.log(`[JavaDebug -> SERVER] seq=${seq}, cmd=${command}`);
    debugSocketRef.current.send(message);
    return seq;
  };

  const startDebugging = async () => {
    if (!languageClientInstanceRef.current || !projectDir) {
      alert('Java 서버가 준비되지 않았습니다.');
      return;
    }

    try {
      setJavaTerminalOutput([{ type: 'out', text: '[디버그 세션을 준비하는 중...]\n' }]);
      setIsDebugging(true);

      // 1. JDTLS에 디버그 세션 시작 요청 (포트 획득)
      let port = null;
      try {
        window.electronAPI?.log('info', '[JavaDebug] Attempting to start debug session...');
        port = await languageClientInstanceRef.current.sendRequest('workspace/executeCommand', {
          command: 'vscode.java.startDebugSession',
          arguments: []
        });
      } catch (e: any) {
        window.electronAPI?.log('error', `[JavaDebug] startDebugSession failed`, e.message);
        throw e;
      }

      if (!port) {
        window.electronAPI?.log('error', '[JavaDebug] Failed to start debug: Server port not received.');
        throw new Error('디버그 서버 포트를 받지 못했습니다. java-debug 번들이 설치되어 있는지 확인하세요.');
      }

      setJavaDebugPort(port);
      window.electronAPI?.log('info', `[JavaDebug] Debug Server TCP Port: ${port}`);

      // 2. 디버그 서버 브릿징 요청 (TCP -> WebSocket)
      const wsPort = await window.electronAPI?.startJavaDebugBridge(port);
      if (!wsPort) throw new Error('디버그 브릿지 생성에 실패했습니다.');

      console.log(`[JavaDebug] Debug Server WS Port: ${wsPort}`);

      const wsUrl = `ws://127.0.0.1:${wsPort}`;
      const socket = new WebSocket(wsUrl);
      debugSocketRef.current = socket;
      socket.onopen = () => {
        console.log('[JavaDebug] Connected to Debug Server');
        // 3. DAP 초기화 시퀀스
        sendDapRequest('initialize', {
          clientID: 'gptviewer',
          clientName: 'GPT Viewer Debugger',
          adapterID: 'java',
          linesStartAt1: true,
          columnsStartAt1: true,
          pathFormat: 'path'
        });
      };

      let buffer = new Uint8Array(0);
      socket.onmessage = async (event) => {
        let newData: Uint8Array;
        if (event.data instanceof Blob) {
            newData = new Uint8Array(await event.data.arrayBuffer());
        } else if (event.data instanceof ArrayBuffer) {
            newData = new Uint8Array(event.data);
        } else if (typeof event.data === 'string') {
            newData = new TextEncoder().encode(event.data);
        } else {
            newData = new Uint8Array(0);
        }
        
        const newBuffer = new Uint8Array(buffer.length + newData.length);
        newBuffer.set(buffer, 0);
        newBuffer.set(newData, buffer.length);
        buffer = newBuffer;

        let keepReading = true;
        while (keepReading) {
          let headerEndIdx = -1;
          for (let i = 0; i < buffer.length - 3; i++) {
            if (buffer[i] === 13 && buffer[i+1] === 10 && buffer[i+2] === 13 && buffer[i+3] === 10) {
              headerEndIdx = i;
              break;
            }
          }

          if (headerEndIdx === -1) {
            keepReading = false;
            break;
          }

          const headerBytes = buffer.slice(0, headerEndIdx);
          const headerStr = new TextDecoder().decode(headerBytes);
          const match = headerStr.match(/Content-Length:\s*(\d+)/i);
          if (!match) {
            console.error('[JavaDebug] Invalid DAP header (No Content-Length):', headerStr);
            buffer = new Uint8Array(0); // 헤더 파싱 실패 시 버퍼 비움
            break;
          }

          const contentLength = parseInt(match[1], 10);
          const totalLength = headerEndIdx + 4 + contentLength;

          if (buffer.length < totalLength) {
            keepReading = false;
            break; // 데이터가 아직 덜 옴
          }

          const bodyBytes = buffer.slice(headerEndIdx + 4, totalLength);
          buffer = buffer.slice(totalLength);
          
          const body = new TextDecoder().decode(bodyBytes);

          try {
            const msg = JSON.parse(body);
            console.log('[JavaDebug <- SERVER]', msg);
            window.electronAPI?.log('info', `[JavaDebug <- SERVER Raw]`, JSON.stringify(msg));

            if (msg.type === 'event') {
              window.electronAPI?.log('info', `[JavaDebug] EVENT: ${msg.event}`, JSON.stringify(msg.body));
              if (msg.event === 'initialized') {
                console.log('[JavaDebug] Server Initialized Event received, sending breakpoints...');
                window.electronAPI?.log('info', '[JavaDebug] Sending breakpoints...');
                // 브레이크포인트 설정
                for (const [path, lines] of breakpoints.entries()) {
                  sendDapRequest('setBreakpoints', {
                    source: { path },
                    breakpoints: lines.map(l => ({ line: l }))
                  });
                }
                
                // JDTLS 디버그 서버는 configurationDone을 기다림
                setTimeout(() => {
                  console.log('[JavaDebug] Sending configurationDone...');
                  window.electronAPI?.log('info', '[JavaDebug] Sending configurationDone...');
                  sendDapRequest('configurationDone');
                }, 500);
              } else if (msg.event === 'stopped') {
                console.log('[JavaDebug] Program Paused', msg.body);
                window.electronAPI?.log('info', '[JavaDebug] Program Paused', msg.body);
                setPausedLocation({
                  filePath: msg.body.source?.path || '',
                  lineNumber: msg.body.line
                });
                // 스택 프레임 및 변수 요청
                sendDapRequest('stackTrace', { threadId: msg.body.threadId });
              } else if (msg.event === 'output') {
                const text = msg.body.output;
                const category = msg.body.category === 'stderr' ? 'err' : 'out';
                if (text && !text.includes('java.compiler system property is obsolete')) {
                  setJavaTerminalOutput(prev => [...prev, { type: category, text }]);
                }
              } else if (msg.event === 'terminated') {
                window.electronAPI?.log('info', '[JavaDebug] Session Terminated');
                setIsDebugging(false);
                setPausedLocation(null);
                setStackFrames([]);
                setVariables([]);
                setJavaTerminalOutput(prev => [...prev, { type: 'out', text: '\n[디버그 세션이 종료되었습니다.]\n' }]);
              }
            } else if (msg.type === 'response') {
              console.log(`[JavaDebug] Response for command: ${msg.command}`, msg);
              window.electronAPI?.log('info', `[JavaDebug] RESPONSE: ${msg.command} (success: ${msg.success})`, msg.body || msg.message);
              if (msg.command === 'initialize' && msg.success) {
                // DAP 표준: initialize 응답 후 launch 또는 attach 요청 전송
                console.log('[JavaDebug] Initialize successful. Triggering launch...');
                window.electronAPI?.log('info', '[JavaDebug] Initialize successful. Triggering launch...');
                sendDapRequest('launch', {
                  mainClass: getJavaFullClassName(javaFilePathRef.current || '', projectDir),
                  projectName: 'temp-java-project',
                  cwd: projectDir,
                  console: 'internalConsole',
                  stopOnEntry: true,
                  classPaths: [projectDir + '/bin'],
                  modulePaths: [],
                  vmArgs: '--enable-preview'
                });
              } else if (msg.command === 'launch' && msg.success) {
                console.log('[JavaDebug] Launch successful.');
                window.electronAPI?.log('info', '[JavaDebug] Launch successful.');
              } else if (msg.command === 'stackTrace' && msg.body?.stackFrames) {
                setStackFrames(msg.body.stackFrames);
                if (msg.body.stackFrames.length > 0) {
                  sendDapRequest('scopes', { frameId: msg.body.stackFrames[0].id });
                }
              } else if (msg.command === 'scopes' && msg.body?.scopes) {
                // 가장 첫 번째 scope (보통 Local)의 변수 요청
                const localScope = msg.body.scopes[0];
                if (localScope) {
                  sendDapRequest('variables', { variablesReference: localScope.variablesReference });
                }
              } else if (msg.command === 'variables' && msg.body?.variables) {
                setVariables(msg.body.variables);
              }
            }
          } catch (e) {
            console.error('[JavaDebug] Failed to parse message', e);
          }
        }
      };

      socket.onerror = (err) => {
        console.error('[JavaDebug] WebSocket Error', err);
        setJavaTerminalOutput(prev => [...prev, { type: 'err', text: '디버그 서버 연결에 실패했습니다. (WebSocket 브릿지가 필요할 수 있습니다.)\n' }]);
        setIsDebugging(false);
      };

      socket.onclose = () => {
        console.log('[JavaDebug] Connection Closed');
        setIsDebugging(false);
      };

    } catch (err: any) {
      console.error('[JavaDebug] Failed to start debug', err);
      setJavaTerminalOutput(prev => [...prev, { type: 'err', text: `디버그 시작 실패: ${err.message}\n` }]);
      setIsDebugging(false);
    }
  };

  const stopDebugging = () => {
    sendDapRequest('disconnect', { restart: false });
    if (debugSocketRef.current) {
      debugSocketRef.current.close();
    }
    setIsDebugging(false);
    setPausedLocation(null);
    setStackFrames([]);
    setVariables([]);
    setEditingVariable(null);
  };

  const handleVariableValueChange = async (name: string, value: string, variablesReference: number) => {
    sendDapRequest('setVariable', {
      variablesReference,
      name,
      value
    });
    setEditingVariable(null);
    // 변경 후 즉시 갱신을 위해 다시 요청할 수도 있지만, 일단 응답 대기
  };

  const updatePausedLocationDecoration = (editor: any, location: { filePath: string, lineNumber: number } | null) => {
    if (!editor) return;
    const currentPath = javaFilePathRef.current;
    
    let newDecorations: any[] = [];
    if (location && location.filePath === currentPath) {
      newDecorations = [{
        range: new monaco.Range(location.lineNumber, 1, location.lineNumber, 1),
        options: {
          isWholeLine: true,
          className: 'debug-current-line',
          marginClassName: 'debug-current-line-margin'
        }
      }];
    }

    currentLineDecorationRef.current = editor.deltaDecorations(currentLineDecorationRef.current, newDecorations);
    
    // 일치하는 파일이라면 해당 위치로 스크롤
    if (location && location.filePath === currentPath) {
      editor.revealLineInCenter(location.lineNumber);
    }
  };

  useEffect(() => {
    if (editorInstance) {
      updatePausedLocationDecoration(editorInstance, pausedLocation);
    }
  }, [pausedLocation, editorInstance, javaFilePath]);

  // --- 브레이크포인트 관리 ---
  const toggleBreakpoint = (filePath: string, lineNumber: number) => {
    setBreakpoints(prev => {
      const next = new Map(prev);
      const lines = next.get(filePath) || [];
      if (lines.includes(lineNumber)) {
        next.set(filePath, lines.filter(l => l !== lineNumber));
      } else {
        next.set(filePath, [...lines, lineNumber]);
      }
      return next;
    });
  };

  const updateEditorBreakpoints = (editor: any, filePath: string) => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const modelId = model.id;
    
    const currentLines = breakpoints.get(filePath) || [];
    const newDecorations = currentLines.map(line => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        marginClassName: 'debug-breakpoint',
        glyphMarginHoverMessage: { value: 'Breakpoint' }
      }
    }));

    const oldDecorationIds = breakpointDecorationsRef.current.get(modelId) || [];
    const nextDecorationIds = editor.deltaDecorations(oldDecorationIds, newDecorations);
    breakpointDecorationsRef.current.set(modelId, nextDecorationIds);
  };

  useEffect(() => {
    if (editorInstance && javaFilePath) {
      updateEditorBreakpoints(editorInstance, javaFilePath);
    }
  }, [breakpoints, editorInstance, javaFilePath]);

  // --- 추가된 파일/폴더 관리 상태 ---
  const [creatingItemState, setCreatingItemState] = useState<{ parentPath: string, type: 'file' | 'directory' } | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const newItemInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creatingItemState && newItemInputRef.current) {
      newItemInputRef.current.focus();
    }
  }, [creatingItemState]);


  // 출력 발생 시 터미널 내부만 스크롤을 맨 아래로 이동
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [javaTerminalOutput]);

  // IPC 이벤트 리스너 등록 (백엔드에서 오는 실시간 출력 및 종료 이벤트 수신)
  useEffect(() => {
    if (!javaSessionId) return; // 실행 중인 세션이 없으면 리스너를 등록하지 않음

    let unsubOut: (() => void) | undefined;
    let unsubErr: (() => void) | undefined;
    let unsubExit: (() => void) | undefined;

    if (window.electronAPI && window.electronAPI.onJavaRunOutput) {
      unsubOut = window.electronAPI.onJavaRunOutput((sid, data) => {
        if (sid === javaSessionId) setJavaTerminalOutput(prev => [...prev, { type: 'out', text: data }]);
      });
      unsubErr = window.electronAPI.onJavaRunError((sid, data) => {
        if (sid === javaSessionId) {
          const filtered = data
            .split('\n')
            .filter(line => !line.includes('java.compiler system property is obsolete'))
            .join('\n');
          if (filtered.trim()) {
            setJavaTerminalOutput(prev => [...prev, { type: 'err', text: filtered }]);
          }
        }
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

  // 컴포넌트 언마운트 시 혹은 프로젝트 디렉토리 변경 시 스냅샷 저장 보장
  useEffect(() => {
    return () => {
      if (projectDir) {
        saveCurrentProjectSnapshot(projectDir);
      }
    };
  }, [projectDir]);

  const lspStatusRef = useRef(lspStatus);
  const javaFilePathRef = useRef(javaFilePath);
  const languageClientInstanceRef = useRef<any>(null);

  useEffect(() => { lspStatusRef.current = lspStatus; }, [lspStatus]);
  useEffect(() => { javaFilePathRef.current = javaFilePath; }, [javaFilePath]);

  const activeJavaSource = customJavaSource !== null ? customJavaSource : code;

  const currentLanguage = useMemo(() => {
    if (!javaFilePath) return 'java';
    return getLanguageFromFile(javaFilePath.split(/[/\\]/).pop() || '');
  }, [javaFilePath]);

  const saveCurrentProjectSnapshot = async (currentDir: string) => {
    if (!currentDir) return;
    try {
      const snapshot = await window.electronAPI?.getJavaProjectSnapshot(currentDir);
      if (snapshot && Object.keys(snapshot).length > 0) {
        saveCustomJavaProjectToCache(sharedCustomJavaCacheKey, snapshot);
      }
    } catch (e) {
      console.error('[JavaBlock] Failed to save project snapshot', e);
    }
  };

  // 내용 변경 시 자동 저장
  const handleContentChange = (value: string | undefined) => {
    const newContent = value || '';
    setCurrentFileContent(newContent);
    
    if (javaFilePath) {
      // 1. 즉시 메모리 상태 업데이트
      if (javaFilePath === originalJavaFilePath) {
        setCustomJavaSource(newContent);
        saveCustomJavaSourceToCache(sharedCustomJavaCacheKey, newContent);
      }
      
      // 2. 백엔드 파일 업데이트 (비동기)
      window.electronAPI?.updateJavaFile(javaFilePath, newContent).then(() => {
        // 3. 스냅샷 저장은 성능을 위해 여기서 매번 하지 않고, 
        // handleCreateItemSubmit 이나 편집 종료 시점에 확실히 수행함.
        // 혹은 필요한 경우 여기서 디바운스된 호출을 할 수 있음.
      });
    }
  };

  const refreshProjectTree = async (dir: string) => {
    try {
      const tree = await window.electronAPI?.getJavaProjectTree(dir);
      if (tree) setProjectTree(tree);
    } catch (e) {
      console.error('Failed to refresh project tree', e);
    }
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
          const cachedProject = loadCustomJavaProjectFromCache(sharedCustomJavaCacheKey);
          const res = (await window.electronAPI?.startJavaServer(activeJavaSource, cachedProject || undefined)) as any;
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

            console.log(`[JavaBlock] Initializing LSP with projectDir: ${res.projectDir} and bundles:`, res.bundles);
            const client = await createJavaLanguageClient(res.port, res.projectDir, monacoInstance, res.bundles);
            console.log('[JavaBlock] createJavaLanguageClient resolved:', !!client);

            if (isMounted) {
              languageClient = client;
              languageClientInstanceRef.current = client;
              setLspStatus('connected');

              // 서버가 지원하는 명령어 목록 출력 (디버깅 진단용)
              const caps = (client as any).initializeResult?.capabilities;
              if (caps?.executeCommandProvider?.commands) {
                console.log('[JavaBlock] Server Commands:', caps.executeCommandProvider.commands);
              }
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
      symbols: /[=><!~?:&|+\-*/^%]+/,
      escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
      tokenizer: {
        root: [
          // 어노테이션 (예: @Override)
          [/@[a-zA-Z_]\w*/, 'annotation'],
          // 대문자로만 이루어진 단어 (상수, 예: MAX_VALUE)
          [/[A-Z][A-Z0-9_]*\b/, 'constant'],
          // 대문자로 시작하는 단어는 클래스/인터페이스로 간주 (예: String, System)
          [/[A-Z][\w$]*\b/, 'type.identifier'],
          // 소문자로 시작하고 뒤에 '('가 오면 메서드로 간주
          [/[a-z_$][\w$]*(?=\s*\()/, 'function'],
          // 일반 식별자 (예: 변수)
          [/[a-zA-Z_$][\w$]*\b/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          { include: '@whitespace' },
          [/[{}()[\]]/, '@brackets'],
          [/[;,.]/, 'delimiter'],
          [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
          [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
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
          [/[^/*]+/, 'comment'],
          [/\/\*/, 'comment', '@push' ],
          ["\\*/", 'comment', '@pop'  ],
          [/[/*]/, 'comment']
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

    // 마우스 클릭으로 브레이크포인트 토글 (Glyph Margin, Line Numbers, Decorations 클릭 시)
    const mouseDownDisposable = editor.onMouseDown((e: any) => {
      // 2: GLYPH_MARGIN, 3: LINE_NUMBERS, 4: LINE_DECORATIONS
      if (e.target.type === 2 || e.target.type === 3 || e.target.type === 4) {
        const line = e.target.position.lineNumber;
        const currentPath = javaFilePathRef.current;
        if (currentPath) {
          toggleBreakpoint(currentPath, line);
        }
      }
    });

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
          textDocument: { uri: `file://${currentFilePath}`, languageId, version: docVersionRef.current++, text: currentText }
        });

        currentClient.sendNotification("textDocument/didChange", {
          textDocument: { uri: `file://${currentFilePath}`, version: docVersionRef.current++ },
          contentChanges: [{ text: currentText }]
        });

        return await currentClient.sendRequest(method, params);
      } catch (e) {
        return null;
      }
    };

    const supportedLanguages = ['java', 'xml', 'plaintext'];
    const disposables: any[] = [mouseDownDisposable];

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
          const contents: any[] = [];
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

  const handleCreateItemSubmit = async (e: React.KeyboardEvent | React.FocusEvent) => {
    if ((e.type === 'keydown' && (e as React.KeyboardEvent).key !== 'Enter') || !creatingItemState) return;
    
    const name = newItemName.trim();
    if (!name) {
      setCreatingItemState(null);
      setNewItemName('');
      return;
    }

    // Windows와 Unix 환경의 경로 구분자 차이를 안전하게 처리
    let parentRelPath = creatingItemState.parentPath.replace(projectDir!, '');
    parentRelPath = parentRelPath.replace(/^[/\\]+/, ''); // 맨 앞의 슬래시 제거
    
    let finalRelPath = '';

    // 만약 파일 생성이고 이름에 점(.)이 포함되어 있다면 (예: com.example.Test)
    // 그리고 아직 확장자가 명시되지 않았다면 점을 경로 구분자로 해석합니다.
    if (creatingItemState.type === 'file' && name.includes('.') && !name.toLowerCase().endsWith('.java') && !name.toLowerCase().endsWith('.xml')) {
      const parts = name.split('.');
      const className = parts.pop();
      const packagePath = parts.join('/');
      
      // 항상 src 하위에 패키지 구조를 생성하도록 유도 (import 가능하게)
      finalRelPath = `src/${packagePath}/${className}.java`;
    } else {
      // 일반적인 파일/폴더 생성
      let fileNameWithExt = name;
      if (creatingItemState.type === 'file' && !name.includes('.')) {
        fileNameWithExt = name + '.java';
      }

      if (parentRelPath) {
        finalRelPath = parentRelPath + '/' + fileNameWithExt;
      } else {
        // 루트에 파일을 만들 때도 src 하위로 유도하는 것이 좋음 (Java 관례)
        finalRelPath = `src/${fileNameWithExt}`;
      }
    }
    
    try {
      console.log(`[JavaBlock] Creating ${creatingItemState.type}: ${finalRelPath}`);
      if (creatingItemState.type === 'file') {
        const className = finalRelPath.split(/[/\\]/).pop()?.replace('.java', '') || 'Main';
        
        let defaultContent = '';
        if (finalRelPath.endsWith('.java')) {
          // src/ 이후의 경로를 추출하여 패키지명 생성
          const srcPattern = /^src[/\\]/;
          if (srcPattern.test(finalRelPath)) {
            const pathAfterSrc = finalRelPath.replace(srcPattern, '');
            // 슬래시나 백슬래시가 포함되어 있어야 하위 패키지가 존재하는 것임
            if (pathAfterSrc.includes('/') || pathAfterSrc.includes('\\')) {
              const packagePath = pathAfterSrc
                .replace(/[/\\][^/\\]+$/, '') // '파일명.java' 제거
                .replace(/[/\\]/g, '.'); // '/'를 '.'으로 변경
              
              if (packagePath) {
                defaultContent = `package ${packagePath};\n\n`;
              }
            }
          }
          defaultContent += `public class ${className} {\n    \n}\n`;
        }
        
        const res = await window.electronAPI?.createJavaFile(projectDir!, finalRelPath, defaultContent);
        if (!res?.success) console.error('[JavaBlock] File creation failed:', res?.error);
      } else {
        const res = await window.electronAPI?.createJavaDirectory(projectDir!, finalRelPath);
        if (!res?.success) console.error('[JavaBlock] Dir creation failed:', res?.error);
      }
      refreshProjectTree(projectDir!);
      await saveCurrentProjectSnapshot(projectDir!);
    } catch (err) {
      console.error('[JavaBlock] Failed to create item', err);
    }
    
    setCreatingItemState(null);
    setNewItemName('');
  };

  const handleDeleteItem = async (e: React.MouseEvent, nodePath: string) => {
    e.stopPropagation();
    if (!confirm('정말 삭제하시겠습니까?')) return;
    
    let relativePath = nodePath.replace(projectDir!, '');
    relativePath = relativePath.replace(/^[/\\]+/, '');
    
    try {
      console.log(`[JavaBlock] Deleting: ${relativePath}`);
      const res = await window.electronAPI?.deleteJavaPath(projectDir!, relativePath);
      if (!res?.success) console.error('[JavaBlock] Deletion failed:', res?.error);
      
      if (javaFilePath === nodePath) {
        setJavaFilePath(null);
        setCurrentFileContent('');
      }
      refreshProjectTree(projectDir!);
      await saveCurrentProjectSnapshot(projectDir!);
    } catch (err) {
      console.error('[JavaBlock] Failed to delete item', err);
    }
  };

  const renderTree = (nodes: any[], depth = 0, _parentPath = projectDir!) => (
    <div style={{ marginLeft: depth > 0 ? '12px' : '0' }}>
      {nodes.map(node => (
        <div key={node.path}>
          <div
            className="tree-node-row"
            onClick={() => handleFileClick(node)}
            style={{
              fontSize: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center',
              color: isDark ? '#ccc' : '#333', cursor: 'pointer',
              backgroundColor: javaFilePath === node.path ? (isDark ? '#37373d' : '#e4e6f1') : 'transparent',
              borderRadius: '3px', whiteSpace: 'nowrap', userSelect: 'none',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              const actions = e.currentTarget.querySelector('.tree-node-actions');
              if (actions) (actions as HTMLElement).style.display = 'flex';
            }}
            onMouseLeave={(e) => {
              const actions = e.currentTarget.querySelector('.tree-node-actions');
              if (actions) (actions as HTMLElement).style.display = 'none';
            }}
          >
            <span style={{ marginRight: '6px', fontSize: '14px' }}>
              {node.type === 'directory' ? (expandedPaths.has(node.path) ? '📂' : '📁') : '📄'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flexGrow: 1 }}>{node.name}</span>
            
            {node.path === originalJavaFilePath && (
              <span style={{ marginLeft: '4px', fontSize: '10px', color: '#007acc', fontWeight: 'bold' }}>(ORIGINAL)</span>
            )}

            <div className="tree-node-actions" style={{ display: 'none', alignItems: 'center', gap: '4px', paddingLeft: '8px' }}>
              {node.type === 'directory' && (
                <>
                  <span title="새 파일" onClick={(e) => { e.stopPropagation(); setExpandedPaths(new Set(expandedPaths).add(node.path)); setCreatingItemState({ parentPath: node.path, type: 'file' }); }} style={{ fontSize: '14px', opacity: 0.7, padding: '0 2px' }}>📄+</span>
                  <span title="새 폴더" onClick={(e) => { e.stopPropagation(); setExpandedPaths(new Set(expandedPaths).add(node.path)); setCreatingItemState({ parentPath: node.path, type: 'directory' }); }} style={{ fontSize: '14px', opacity: 0.7, padding: '0 2px' }}>📁+</span>
                </>
              )}
              <span title="삭제" onClick={(e) => handleDeleteItem(e, node.path)} style={{ fontSize: '14px', opacity: 0.7, color: '#f44336', padding: '0 2px' }}>🗑</span>
            </div>
          </div>
          
          {/* 새 항목 입력 UI */}
          {creatingItemState?.parentPath === node.path && expandedPaths.has(node.path) && (
            <div style={{ marginLeft: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center' }}>
              <span style={{ marginRight: '6px', fontSize: '14px' }}>{creatingItemState.type === 'file' ? '📄' : '📁'}</span>
              <input
                ref={newItemInputRef}
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                onKeyDown={handleCreateItemSubmit}
                onBlur={handleCreateItemSubmit}
                style={{
                  fontSize: '12px', padding: '2px 4px', border: `1px solid ${isDark ? '#555' : '#ccc'}`,
                  backgroundColor: isDark ? '#1e1e1e' : '#fff', color: isDark ? '#fff' : '#000', outline: 'none', flexGrow: 1
                }}
                placeholder={creatingItemState.type === 'file' ? '파일명.java' : '폴더명'}
              />
            </div>
          )}

          {node.type === 'directory' && node.children && expandedPaths.has(node.path) && renderTree(node.children, depth + 1, node.path)}
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
              setJavaTerminalOutput([{ type: 'out', text: '[프로세스를 시작하는 중...]\n' }]);
              setIsJavaRunning(true);
              setJavaResult(null);

              try {
                // 실행 전 최신 스냅샷 확보
                let snapshot = undefined;
                if (projectDir) {
                  snapshot = await window.electronAPI?.getJavaProjectSnapshot(projectDir);
                  if (snapshot) saveCustomJavaProjectToCache(sharedCustomJavaCacheKey, snapshot);
                }

                const res = await window.electronAPI?.startInteractiveJava(sid, activeJavaSource, snapshot || undefined);
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

          <button className={`code-block__action-button${isDebugging ? ' is-active' : ''}`} type="button"
            onClick={async () => {
              if (isDebugging) {
                stopDebugging();
                return;
              }
              startDebugging();
            }}>
            {isDebugging ? '⏹ 디버그 중지' : '🐞 디버그'}
          </button>

          {isDebugging && pausedLocation && (
            <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
              <button className="code-block__action-button" title="Continue (F5)" onClick={() => { setPausedLocation(null); sendDapRequest('continue', { threadId: 1 }); }}>▶</button>
              <button className="code-block__action-button" title="Step Over (F6)" onClick={() => { setPausedLocation(null); sendDapRequest('next', { threadId: 1 }); }}>↷</button>
              <button className="code-block__action-button" title="Step Into (F7)" onClick={() => { setPausedLocation(null); sendDapRequest('stepIn', { threadId: 1 }); }}>↓</button>
              <button className="code-block__action-button" title="Step Out (F8)" onClick={() => { setPausedLocation(null); sendDapRequest('stepOut', { threadId: 1 }); }}>↑</button>
            </div>
          )}
          {isJavaEditMode && (
            <button className="code-block__action-button" type="button" onClick={async () => {
              if (confirm('현재 편집 중인 메인 파일의 내용을 원본으로 초기화하시겠습니까? (추가한 다른 파일들은 유지됩니다.)')) {
                // 1. 원본 소스 캐시 제거
                clearCustomJavaSourceFromCache(sharedCustomJavaCacheKey);
                setCustomJavaSource(null);
                
                // 2. 만약 프로젝트가 실행 중이라면 실제 파일도 원본으로 덮어씀
                if (originalJavaFilePath && projectDir) {
                  try {
                    await window.electronAPI?.updateJavaFile(originalJavaFilePath, code);
                    // 최신 스냅샷 저장 (다른 파일들 유지됨)
                    const snapshot = await window.electronAPI?.getJavaProjectSnapshot(projectDir);
                    if (snapshot) {
                      saveCustomJavaProjectToCache(sharedCustomJavaCacheKey, snapshot);
                    }
                    // 현재 에디터 내용도 원본으로 갱신 (만약 메인 파일을 보고 있었다면)
                    if (javaFilePath === originalJavaFilePath) {
                      setCurrentFileContent(code);
                    }
                  } catch (e) {
                    console.error('[JavaBlock] Failed to reset original file content', e);
                  }
                } else {
                  // 프로젝트 시작 전이라면 에디터 내용만 변경
                  setCurrentFileContent(code);
                }
              }
            }}>
              원본 복원
            </button>
          )}
          <button className={`code-block__action-button${isJavaEditMode ? ' is-active' : ''}`} type="button" onClick={async () => {
            if (isJavaEditMode && projectDir) {
              await saveCurrentProjectSnapshot(projectDir);
            }
            setIsJavaEditMode(!isJavaEditMode);
          }}>
            {isJavaEditMode ? '편집 종료' : '편집'}
          </button>
        </div>
      </div>

      <div style={{
        display: 'flex',
        height: 'auto',
        backgroundColor: isDark ? '#1e1e1e' : '#fff',
        position: 'relative',
        overflow: 'visible'
      }}>
        {isJavaEditMode && showDrawer && (
          <div style={{
            width: '240px', borderRight: isDark ? '1px solid #333' : '1px solid #ddd',
            padding: '0', overflowY: 'auto', backgroundColor: isDark ? '#252526' : '#f3f3f3', flexShrink: 0,
            display: 'flex', flexDirection: 'column'
          }}>
            {/* 드로어 모드 탭 */}
            <div style={{ display: 'flex', borderBottom: isDark ? '1px solid #333' : '1px solid #ddd', flexShrink: 0 }}>
              <button 
                onClick={() => setDrawerMode('files')}
                style={{
                  flex: 1, padding: '10px', border: 'none', background: drawerMode === 'files' ? (isDark ? '#1e1e1e' : '#fff') : 'transparent',
                  color: drawerMode === 'files' ? (isDark ? '#fff' : '#000') : '#888', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
                  borderBottom: drawerMode === 'files' ? '2px solid #007acc' : 'none', outline: 'none'
                }}>파일</button>
              <button 
                onClick={() => setDrawerMode('debug')}
                style={{
                  flex: 1, padding: '10px', border: 'none', background: drawerMode === 'debug' ? (isDark ? '#1e1e1e' : '#fff') : 'transparent',
                  color: drawerMode === 'debug' ? (isDark ? '#fff' : '#000') : '#888', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
                  borderBottom: drawerMode === 'debug' ? '2px solid #007acc' : 'none', outline: 'none'
                }}>🐞 디버그</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {drawerMode === 'files' ? (
                <div style={{ padding: '10px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 10px 8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: isDark ? '#858585' : '#666', textTransform: 'uppercase' }}>EXPLORER</div>
                    {projectDir && (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span title="새 파일" onClick={() => setCreatingItemState({ parentPath: projectDir, type: 'file' })} style={{ fontSize: '13px', cursor: 'pointer', opacity: 0.7 }}>📄+</span>
                        <span title="새 폴더" onClick={() => setCreatingItemState({ parentPath: projectDir, type: 'directory' })} style={{ fontSize: '13px', cursor: 'pointer', opacity: 0.7 }}>📁+</span>
                      </div>
                    )}
                  </div>
                  
                  {/* 최상위 루트 생성 UI */}
                  {creatingItemState?.parentPath === projectDir && (
                    <div style={{ marginLeft: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ marginRight: '6px', fontSize: '14px' }}>{creatingItemState.type === 'file' ? '📄' : '📁'}</span>
                      <input
                        ref={newItemInputRef}
                        value={newItemName}
                        onChange={e => setNewItemName(e.target.value)}
                        onKeyDown={handleCreateItemSubmit}
                        onBlur={handleCreateItemSubmit}
                        style={{
                          fontSize: '12px', padding: '2px 4px', border: `1px solid ${isDark ? '#555' : '#ccc'}`,
                          backgroundColor: isDark ? '#1e1e1e' : '#fff', color: isDark ? '#fff' : '#000', outline: 'none', flexGrow: 1
                        }}
                        placeholder={creatingItemState.type === 'file' ? '파일명.java' : '폴더명'}
                      />
                    </div>
                  )}

                  {renderTree(projectTree)}
                </div>
              ) : (
                <div style={{ padding: '10px', fontSize: '12px' }}>
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '8px', color: isDark ? '#858585' : '#666', fontSize: '11px', textTransform: 'uppercase' }}>STACK TRACE</div>
                    {stackFrames.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {stackFrames.map(frame => (
                          <div key={frame.id} style={{ 
                            padding: '4px 8px', borderRadius: '4px', cursor: 'pointer',
                            backgroundColor: pausedLocation?.lineNumber === frame.line ? (isDark ? '#37373d' : '#e4e6f1') : 'transparent',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                          }}>
                            <span style={{ color: isDark ? '#dcdcaa' : '#795e26' }}>{frame.name}</span>
                            <span style={{ opacity: 0.5, marginLeft: '4px' }}>:{frame.line}</span>
                          </div>
                        ))}
                      </div>
                    ) : <div style={{ opacity: 0.5, fontStyle: 'italic', padding: '0 8px' }}>실행 중이 아닙니다.</div>}
                  </div>
                  
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: '8px', color: isDark ? '#858585' : '#666', fontSize: '11px', textTransform: 'uppercase' }}>VARIABLES</div>
                    {variables.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 8px' }}>
                        {variables.map(v => (
                          <div key={v.name} style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                            <span style={{ color: isDark ? '#9cdcfe' : '#001080', fontWeight: '500' }}>{v.name}</span>
                            <span style={{ color: isDark ? '#cccccc' : '#333333' }}>=</span>
                            {editingVariable?.name === v.name ? (
                              <input
                                autoFocus
                                defaultValue={v.value}
                                onBlur={(e) => handleVariableValueChange(v.name, e.target.value, editingVariable.ref)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleVariableValueChange(v.name, (e.target as HTMLInputElement).value, editingVariable.ref);
                                  else if (e.key === 'Escape') setEditingVariable(null);
                                }}
                                style={{
                                  fontSize: '12px', padding: '0 2px', border: '1px solid #007acc',
                                  backgroundColor: isDark ? '#1e1e1e' : '#fff', color: isDark ? '#fff' : '#000', outline: 'none'
                                }}
                              />
                            ) : (
                              <span 
                                title="클릭하여 값 변경"
                                onClick={() => v.variablesReference === 0 && setEditingVariable({ name: v.name, value: v.value, ref: variables[0].variablesReference || 0 })}
                                style={{ color: isDark ? '#ce9178' : '#a31515', wordBreak: 'break-all', cursor: v.variablesReference === 0 ? 'pointer' : 'default' }}>
                                {v.value}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : <div style={{ opacity: 0.5, fontStyle: 'italic', padding: '0 8px' }}>사용 가능한 변수가 없습니다.</div>}
                  </div>                </div>
              )}
            </div>
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
                <span>{javaFilePath && projectDir ? getJavaFullClassName(javaFilePath, projectDir) : (javaFilePath ? javaFilePath.split(/[/\\]/).pop() : 'Main.java')}</span>
              </div>
              <div style={{ flex: 1 }}></div>
            </div>
          )}
          <div style={{ flexGrow: 1, overflow: 'visible', height: isJavaEditMode ? editorHeight : 'auto' }}>
            {isJavaEditMode ? (
              <Editor
                height="100%"
                path={javaFilePath ? `file://${javaFilePath}` : undefined}
                language={currentLanguage}
                theme={isDark ? 'vscode-dark-custom' : 'vscode-light-custom'}
                value={currentFileContent}
                beforeMount={handleEditorWillMount}
                onChange={handleContentChange}
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
                  'semanticHighlighting.enabled': true,
                  glyphMargin: true,
                  lineNumbersMinChars: 3
                }}
              />
            ) : (
              <div style={{ height: 'auto', overflow: 'visible' }}>
                <MarkdownCodeSourcePanel language="java" themeMode={themeMode} title="" value={activeJavaSource} />
              </div>
            )}
          </div>

          {(javaResult || javaTerminalOutput.length > 0 || isJavaRunning) && (
            <div style={{
              position: 'relative', zIndex: 20, height: '220px', flexShrink: 0,
              display: 'flex', flexDirection: 'column',
              backgroundColor: isDark ? 'rgba(30, 30, 30, 0.98)' : 'rgba(255, 255, 255, 0.98)',
              borderTop: `2px solid ${isJavaRunning ? '#007acc' : (javaTerminalOutput.some(o => o.type === 'err') ? '#f44336' : '#4caf50')}`,
              boxShadow: '0 -4px 12px rgba(0,0,0,0.1)', backdropFilter: 'blur(8px)'
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
