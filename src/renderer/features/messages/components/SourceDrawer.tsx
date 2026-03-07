import { Button } from '../../../components/ui/Button';
import type { MessageSource, SourceDrawerState, SourcePreview } from '../../../types/chat';
import {
  getSourcePreviewDescription,
  getSourcePreviewMeta,
  getSourcePreviewSiteName,
  getSourcePreviewTitle,
} from '../lib/sourceUtils';
import { SourceFavicon } from './SourceFavicon';

type SourceDrawerProps = {
  sourceDrawer: SourceDrawerState | null;
  sourcePreviewCache: Record<string, SourcePreview>;
  sourcePreviewLoading: Record<string, boolean>;
  onClose: () => void;
};

const renderSourceCard = (
  source: MessageSource,
  index: number,
  preview?: SourcePreview,
  isLoadingPreview?: boolean,
) => {
  const description = getSourcePreviewDescription(source, preview);

  return (
    <a
      key={`${source.url}-${index}`}
      className="message-source-link"
      href={source.url}
      target="_blank"
      rel="noreferrer"
    >
      <SourceFavicon preview={preview} source={source} />
      <span className="message-source-link__body">
        <span className="message-source-link__site">
          {getSourcePreviewSiteName(source, preview)}
        </span>
        <span className="message-source-link__title">
          {getSourcePreviewTitle(source, preview)}
        </span>
        <small className="message-source-link__description">
          {description ||
            (isLoadingPreview ? '설명을 불러오는 중입니다.' : '설명이 없습니다.')}
        </small>
        <small className="message-source-link__meta">
          {getSourcePreviewMeta(source)}
        </small>
      </span>
    </a>
  );
};

export function SourceDrawer({
  sourceDrawer,
  sourcePreviewCache,
  sourcePreviewLoading,
  onClose,
}: SourceDrawerProps) {
  return (
    <aside
      className={`source-drawer${sourceDrawer ? ' is-open' : ''}`}
      aria-hidden={sourceDrawer ? 'false' : 'true'}
    >
      <div className="source-drawer__header">
        <div>
          <p className="drawer__eyebrow">출처</p>
          <h2>{sourceDrawer?.heading ?? '출처 패널'}</h2>
        </div>
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      </div>

      <div className="source-drawer__body">
        {sourceDrawer ? (
          <div className="message-sources__list">
            {sourceDrawer.sources.map((source, index) =>
              renderSourceCard(
                source,
                index,
                sourcePreviewCache[source.url],
                sourcePreviewLoading[source.url],
              ),
            )}
          </div>
        ) : (
          <p className="source-drawer__empty">출처가 있는 메시지를 선택해 주세요.</p>
        )}
      </div>
    </aside>
  );
}
