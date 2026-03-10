import { useState, useMemo, useEffect } from 'react';
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

// Monaco Editor 로컬 번들 설정
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
  const [isJavaRunning, setIsJavaRunning] = useState(false);
  const [javaFilePath, setJavaFilePath] = useState<string | null>(null);
  const [lspStatus, setLspStatus] = useState<'idle' | 'starting' | 'connected' | 'error'>('idle');
  const [javaResult, setJavaResult] = useState<{
    error?: string;
    output?: string;
    success?: boolean;
  } | null>(null);

  useEffect(() => {
    let languageClient: any = null;
    let isMounted = true;

    if (isJavaEditMode) {
      setLspStatus('starting');
      (async () => {
        try {
          const res = await window.electronAPI?.startJavaServer(activeJavaSource);
          if (res?.success && isMounted) {
            setJavaFilePath(res.filePath);
            const client = await createJavaLanguageClient(res.port, res.projectDir);

            if (isMounted) {
              languageClient = client;
              setLspStatus('connected');
            } else {
              // unmount 이후라면 생성된 클라이언트를 종료함
              if (client && typeof client.isRunning === 'function' && client.isRunning()) {
                client.stop();
              }
            }
          } else if (res?.error) {
            setLspStatus('error');
            console.error('Failed to start Java LSP server:', res.error);
          }
        } catch (error) {
          setLspStatus('error');
          console.error('Java LSP integration error:', error);
        }
      })();
    } else {
      setLspStatus('idle');
    }

    return () => {
      isMounted = false;
      if (languageClient) {
        try {
          // 상태를 확인하고 stop() 호출
          if (typeof languageClient.isRunning === 'function' && languageClient.isRunning()) {
            languageClient.stop();
          }
        } catch (err) {
          console.warn('Error while stopping language client:', err);
        }
      }
    };
  }, [isJavaEditMode]);

  const activeJavaSource = customJavaSource !== null ? customJavaSource : code;

  const editorHeight = useMemo(() => {
    const lineCount = activeJavaSource.split('\n').length;
    return `${Math.min(Math.max(lineCount * 21 + 20, 200), 800)}px`;
  }, [activeJavaSource]);

  const loadingElement = <div style={{ padding: '20px', color: 'var(--text-muted)' }}>에디터를 로딩하는 중...</div>;

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    // 제안 목록의 상세 정보가 항상 보이도록 설정 보강
    editor.updateOptions({
      suggestSelection: 'first',
      suggest: {
        showInlineDetails: true,
      }
    });

    // 상세 정보 패널(화살표 버튼 클릭 효과)을 기본적으로 펼치기 위한 로컬 스토리지 강제 설정
    try {
      const storageKey = 'expandSuggestionDocs';
      if (!localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, 'true');
      }
    } catch {
      // ignore storage failures
    }

    // 이제 정적 Provider 등록 코드는 모두 제거되었습니다.
    // 모든 언어 지원(호버, 자동완성, 에러 체크)은 LSP 서버를 통해 수행됩니다.
  };

  return (
    <div className="code-block">
      <div className="code-block__header">
        <div className="code-block__header-meta">
          <span className="code-block__language">{formatCodeLanguageLabel('java')}</span>
          {isJavaEditMode && (
            <span style={{
              marginLeft: '10px',
              fontSize: '12px',
              color: lspStatus === 'connected' ? '#4caf50' : lspStatus === 'error' ? '#f44336' : '#ff9800',
              fontWeight: 'bold'
            }}>
              LSP: {lspStatus === 'connected' ? '● 실행 중' : lspStatus === 'starting' ? '○ 시작 중...' : lspStatus === 'error' ? '× 오류' : '정지'}
            </span>
          )}
        </div>
        <div className="code-block__actions">
          {isJavaEditMode && (
            <>
              <button
                className="code-block__action-button"
                type="button"
                onClick={() => {
                  if (customJavaSource !== null) {
                    customJavaSourceStore.set(persistenceKey, customJavaSource);
                    saveCustomJavaSourceToCache(sharedCustomJavaCacheKey, customJavaSource);
                    alert('수정된 코드가 저장되었습니다.');
                  }
                }}
              >
                저장
              </button>
              <button
                className="code-block__action-button"
                type="button"
                onClick={() => {
                  if (window.confirm('사용자 수정을 초기화하고 원본으로 되돌리시겠습니까?')) {
                    customJavaSourceStore.delete(persistenceKey);
                    clearCustomJavaSourceFromCache(sharedCustomJavaCacheKey);
                    setCustomJavaSource(null);
                    setIsJavaEditMode(false);
                  }
                }}
              >
                초기화
              </button>
            </>
          )}
          <button
            className={`code-block__action-button${isJavaRunning ? ' is-loading' : ''}`}
            type="button"
            disabled={isJavaRunning}
            onClick={async () => {
              setIsJavaRunning(true);
              setJavaResult(null);
              try {
                const result = await window.electronAPI?.runJavaCode(activeJavaSource);
                setJavaResult(result || { success: false, error: '실행 결과를 받지 못했습니다.' });
              } catch (err: any) {
                setJavaResult({ success: false, error: err.message });
              } finally {
                setIsJavaRunning(false);
              }
            }}
          >
            {isJavaRunning ? '실행 중...' : '실행'}
          </button>
          <button
            className={`code-block__action-button${isJavaEditMode ? ' is-active' : ''}`}
            type="button"
            onClick={() => setIsJavaEditMode(!isJavaEditMode)}
          >
            {isJavaEditMode ? '편집 종료' : '편집'}
          </button>
        </div>
      </div>
      <div className="code-block__content" style={{ padding: 0 }}>
        {javaResult ? (
          <div className="code-block__issue-panel code-block__issue-panel--warning" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', backgroundColor: '#1e1e1e', color: javaResult.success ? '#d4d4d4' : '#f44747', border: '1px solid #333', margin: '14px 18px', padding: '12px', borderRadius: '8px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '4px' }}>
              실행 결과 {javaResult.success ? '(성공)' : '(실패)'}
            </div>
            {javaResult.output || ''}
            {javaResult.error ? (
              <div style={{ color: '#f44747', marginTop: '8px' }}>
                {javaResult.error}
              </div>
            ) : null}
          </div>
        ) : null}

        {isJavaEditMode ? (
          <div style={{ width: '100%', paddingTop: '8px' }}>
            <Editor
              height={editorHeight}
              path={javaFilePath ? `file://${javaFilePath}` : undefined}
              language="java"
              theme={themeMode === 'dark' ? 'vs-dark' : 'light'}
              value={activeJavaSource}
              onChange={(value) => setCustomJavaSource(value || '')}
              onMount={handleEditorDidMount}
              loading={loadingElement}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
                tabSize: 4,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                quickSuggestions: true,
                suggestOnTriggerCharacters: true,
                wordWrap: 'on',
                lineNumbers: 'on',
                glyphMargin: false,
                folding: true,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                renderLineHighlight: 'all',
                suggest: {
                  showInlineDetails: true,
                },
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'auto',
                  useShadows: false,
                  verticalHasArrows: false,
                  horizontalHasArrows: false,
                  alwaysConsumeMouseWheel: false,
                }
              }}
            />
          </div>
        ) : (
          <div style={{ padding: 0 }}>
            <MarkdownCodeSourcePanel
              language="java"
              themeMode={themeMode}
              title=""
              value={activeJavaSource}
            />
          </div>
        )}
      </div>
    </div>
  );
}
