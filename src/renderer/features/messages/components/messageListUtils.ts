import type { Message } from '../../../types/chat';

export const MESSAGE_LIST_GAP = 14;
export const MESSAGE_LIST_BOTTOM_PADDING = 320; // 하단 여백을 대폭 늘려 스트리밍 공간 확보
export const MESSAGE_LIST_OVERSCAN = 800;
export const MESSAGE_LIST_FALLBACK_VIEWPORT_HEIGHT = 720;
export const CODE_BLOCK_KEEPALIVE_MULTIPLIER_ABOVE = 1.25;
export const CODE_BLOCK_KEEPALIVE_MULTIPLIER_BELOW = 1.75;
export const DIAGRAM_KEEPALIVE_MULTIPLIER_ABOVE = 2;
export const DIAGRAM_KEEPALIVE_MULTIPLIER_BELOW = 3;

export const RENDERABLE_DIAGRAM_PATTERN =
  /```(?:mermaid|svg|xml|html|image\/svg\+xml)\b|<svg[\s>]/i;

export type MessageLayout = {
  end: number;
  height: number;
  message: Message;
  start: number;
};

/**
 * Estimating message height helps reduce layout shifts during initial rendering.
 * We include estimates for code blocks and diagrams to reserve enough space 
 * before they are measured and cached in the persistent store.
 */
export const estimateMessageHeight = (message: Message): number => {
  const baseHeight = message.role === 'assistant' ? 128 : 92;
  const lineEstimate = Math.ceil(message.text.length / 180) * 24;
  const sourceEstimate = message.sources.length > 0 ? 52 : 0;
  
  // Estimate code block height (roughly 100px per block, or more if it looks long)
  const codeBlocks = message.text.match(/```/g) || [];
  const codeBlockCount = Math.floor(codeBlocks.length / 2);
  const codeBlockEstimate = codeBlockCount * 120;
  
  // Extra height for mermaid or diagrams
  const isDiagram = RENDERABLE_DIAGRAM_PATTERN.test(message.text);
  const diagramEstimate = isDiagram ? 300 : 0;

  return baseHeight + lineEstimate + sourceEstimate + codeBlockEstimate + diagramEstimate;
};

export const findStartIndex = (layouts: MessageLayout[], targetOffset: number): number => {
  let low = 0;
  let high = layouts.length - 1;
  let result = layouts.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (layouts[mid].end >= targetOffset) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result === layouts.length ? Math.max(layouts.length - 1, 0) : result;
};

export const findEndIndex = (layouts: MessageLayout[], targetOffset: number): number => {
  let low = 0;
  let high = layouts.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (layouts[mid].start <= targetOffset) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result === -1 ? 0 : result;
};
