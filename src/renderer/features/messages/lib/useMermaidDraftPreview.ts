import { useEffect, useId, useState } from 'react';
import mermaid from 'mermaid';
import { queueMermaidRenderTask } from './mermaidRenderQueue';
import type { ThemeMode } from '../../../types/chat';

type UseMermaidDraftPreviewParams = {
  enabled: boolean;
  source: string;
  themeMode: ThemeMode;
};

export const useMermaidDraftPreview = ({
  enabled,
  source,
  themeMode,
}: UseMermaidDraftPreviewParams) => {
  const blockId = useId().replace(/:/g, '-');
  const normalizedSource = source.trim();
  const [previewMarkup, setPreviewMarkup] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [isPreviewRendering, setIsPreviewRendering] = useState(false);

  useEffect(() => {
    if (!enabled || !normalizedSource) {
      setPreviewMarkup('');
      setPreviewError('');
      setIsPreviewRendering(false);
      return;
    }

    let isCancelled = false;
    const renderDelay = window.setTimeout(() => {
      void (async () => {
        setIsPreviewRendering(true);
        setPreviewError('');

        try {
          const markup = await queueMermaidRenderTask(
            `draft-preview:${themeMode}:${normalizedSource}`,
            async () => {
              mermaid.initialize({
                securityLevel: 'loose',
                startOnLoad: false,
                theme: themeMode === 'dark' ? 'dark' : 'default',
              });

              const { svg } = await mermaid.render(
                `mermaid-draft-preview-${blockId}`,
                normalizedSource,
              );

              return svg;
            },
          );

          if (isCancelled) {
            return;
          }

          setPreviewMarkup(markup);
        } catch (error) {
          if (isCancelled) {
            return;
          }

          setPreviewMarkup('');
          setPreviewError(
            error instanceof Error && error.message
              ? error.message
              : '미리보기를 렌더링하지 못했습니다.',
          );
        } finally {
          if (!isCancelled) {
            setIsPreviewRendering(false);
          }
        }
      })();
    }, 180);

    return () => {
      isCancelled = true;
      window.clearTimeout(renderDelay);
    };
  }, [blockId, enabled, normalizedSource, themeMode]);

  return {
    isPreviewRendering,
    previewError,
    previewMarkup,
  };
};
