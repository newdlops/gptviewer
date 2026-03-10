import {
  HTMLAttributes,
  memo,
  ReactNode,
} from 'react';
import type { ThemeMode } from '../../../types/chat';
import {
  hasRenderableMermaidContent,
  isMermaidLanguage,
  isSvgLanguage,
} from '../lib/markdownCodeBlockUtils';
import { MarkdownCodeSourcePanel } from './MarkdownCodeSourcePanel';
import { MarkdownJavaBlock } from './MarkdownJavaBlock';
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock';

function MarkdownCodeBlockComponent({
  children,
  className,
  persistenceKey,
  renderNonce = 0,
  sharedCacheScope,
  themeMode,
  ...props
}: HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
  persistenceKey: string;
  renderNonce?: number;
  sharedCacheScope?: string;
  themeMode: ThemeMode;
}) {
  const language = className?.match(/language-([\w-]+)/)?.[1];
  const code = String(children ?? '').replace(/\n$/, '');
  const isBlockCode = !!language || code.includes('\n');

  if (!isBlockCode) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  // 1. Java 블록 처리
  if (language === 'java') {
    return (
      <MarkdownJavaBlock
        code={code}
        persistenceKey={persistenceKey}
        sharedCacheScope={sharedCacheScope}
        themeMode={themeMode}
      />
    );
  }

  // 2. Mermaid / SVG 블록 처리
  const isMermaidBlock = isMermaidLanguage(language) && hasRenderableMermaidContent(code);
  const isSvgBlock = isSvgLanguage(language, code);

  if (isMermaidBlock || isSvgBlock) {
    return (
      <MarkdownMermaidBlock
        code={code}
        language={language || (isSvgBlock ? 'svg' : 'mermaid')}
        persistenceKey={persistenceKey}
        renderNonce={renderNonce}
        sharedCacheScope={sharedCacheScope}
        themeMode={themeMode}
      />
    );
  }

  // 3. 일반 코드 블록 처리
  return (
    <div className="code-block">
      <div className="code-block__header">
        <div className="code-block__header-meta">
          <span className="code-block__language">{language || 'text'}</span>
        </div>
      </div>
      <div className="code-block__content" style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <MarkdownCodeSourcePanel
          language={language || 'text'}
          themeMode={themeMode}
          title=""
          value={code}
        />
      </div>
    </div>
  );
}

export const MarkdownCodeBlock = memo(
  MarkdownCodeBlockComponent,
  (previousProps, nextProps) =>
    previousProps.className === nextProps.className &&
    previousProps.persistenceKey === nextProps.persistenceKey &&
    previousProps.renderNonce === nextProps.renderNonce &&
    previousProps.sharedCacheScope === nextProps.sharedCacheScope &&
    previousProps.themeMode === nextProps.themeMode &&
    String(previousProps.children ?? '') === String(nextProps.children ?? ''),
);
