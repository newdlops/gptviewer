import { AnchorHTMLAttributes } from 'react';
import type { MessageSource, SourcePreview } from '../../../types/chat';
import {
  getNodeText,
  getSourcePreviewDescription,
  getSourcePreviewSiteName,
  getSourcePreviewTitle,
} from '../lib/sourceUtils';
import { SourceFavicon } from './SourceFavicon';

export function InlineAssistantLink({
  children,
  href,
  onPreviewNeeded,
  preview,
  source,
  sourcePreviewLoading,
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  onPreviewNeeded: (source: MessageSource) => void;
  preview?: SourcePreview;
  source: MessageSource;
  sourcePreviewLoading: boolean;
}) {
  const handlePreview = () => {
    onPreviewNeeded(source);
  };

  const description = getSourcePreviewDescription(source, preview);
  const label = getSourcePreviewTitle(source, preview);
  const accessibleLabel = getNodeText(children).trim() || label;

  return (
    <span
      className="inline-source-link"
      onFocus={handlePreview}
      onMouseEnter={handlePreview}
    >
      <a
        href={href}
        className="inline-source-link__anchor"
        aria-label={`${accessibleLabel} 열기`}
        target="_blank"
        rel="noreferrer"
      >
        <span className="inline-source-link__label">{label}</span>
      </a>
      <span className="inline-source-link__popover" aria-hidden="true">
        <span className="inline-source-link__card">
          <SourceFavicon preview={preview} source={source} />
          <span className="inline-source-link__card-copy">
            <span className="inline-source-link__site">
              {getSourcePreviewSiteName(source, preview)}
            </span>
            <span className="inline-source-link__title">
              {getSourcePreviewTitle(source, preview)}
            </span>
            <span className="inline-source-link__description">
              {description ||
                (sourcePreviewLoading
                  ? '출처 미리보기를 불러오는 중입니다.'
                  : '이 링크의 미리보기 정보가 없습니다.')}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
