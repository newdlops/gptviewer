import { useState, useMemo } from 'react';
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
  const [javaResult, setJavaResult] = useState<{
    error?: string;
    output?: string;
    success?: boolean;
  } | null>(null);

  const activeJavaSource = customJavaSource !== null ? customJavaSource : code;

  return (
    <div className="code-block">
      <div className="code-block__header">
        <div className="code-block__header-meta">
          <span className="code-block__language">{formatCodeLanguageLabel('java')}</span>
        </div>
        <div className="code-block__actions">
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
      <div className="code-block__content">
        {javaResult ? (
          <div className="code-block__issue-panel code-block__issue-panel--warning" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', backgroundColor: '#1e1e1e', color: javaResult.success ? '#d4d4d4' : '#f44747', border: '1px solid #333', margin: '0 18px 14px', padding: '12px' }}>
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
        <MarkdownCodeSourcePanel
          actions={
            isJavaEditMode ? (
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
                  캐시에 저장
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
            ) : null
          }
          editable={isJavaEditMode}
          language="java"
          onChange={(value) => setCustomJavaSource(value)}
          themeMode={themeMode}
          title={customJavaSource !== null ? (isJavaEditMode ? "Java 코드 편집" : "사용자 수정 Java (적용됨)") : ""}
          value={activeJavaSource}
        />
      </div>
    </div>
  );
}
