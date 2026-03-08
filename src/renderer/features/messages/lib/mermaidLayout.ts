export type WrappedMermaidCandidate = {
  label: string;
  markup: string;
  rowCount: number;
  source: string;
};

export const readMermaidSvgSize = (svgMarkup: string) => {
  const viewBoxMatch = svgMarkup.match(
    /viewBox=["'][^"']*\s([\d.]+)\s([\d.]+)["']/i,
  );
  if (viewBoxMatch) {
    const width = Number.parseFloat(viewBoxMatch[1]);
    const height = Number.parseFloat(viewBoxMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { height, width };
    }
  }

  const widthMatch = svgMarkup.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
  const heightMatch = svgMarkup.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
  if (widthMatch && heightMatch) {
    const width = Number.parseFloat(widthMatch[1]);
    const height = Number.parseFloat(heightMatch[1]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { height, width };
    }
  }

  return null;
};

export const shouldPreferVerticalMermaidLayout = (
  defaultMarkup: string,
  verticalMarkup: string,
  availableWidth?: number,
) => {
  const defaultSize = readMermaidSvgSize(defaultMarkup);
  const verticalSize = readMermaidSvgSize(verticalMarkup);

  if (!defaultSize || !verticalSize) {
    return false;
  }

  const defaultAspect = defaultSize.width / defaultSize.height;
  const verticalAspect = verticalSize.width / verticalSize.height;
  const widthReduction = verticalSize.width / defaultSize.width;
  const normalizedAvailableWidth =
    availableWidth && availableWidth > 0 ? availableWidth : null;
  const defaultOverflowsViewport = normalizedAvailableWidth
    ? defaultSize.width > normalizedAvailableWidth * 1.02
    : false;
  const verticalOverflowsViewport = normalizedAvailableWidth
    ? verticalSize.width > normalizedAvailableWidth * 1.02
    : false;
  const verticalClearlyNarrower = widthReduction < 0.88;
  const verticalModeratelyNarrower = widthReduction < 0.94;

  if (defaultOverflowsViewport && !verticalOverflowsViewport) {
    return true;
  }

  if (defaultOverflowsViewport && verticalClearlyNarrower) {
    return true;
  }

  return (
    (defaultAspect > 1.45 || defaultSize.width > 1400) &&
    verticalModeratelyNarrower &&
    verticalAspect < defaultAspect
  );
};

export const shouldPreferWrappedMermaidLayout = (
  currentMarkup: string,
  wrappedMarkup: string,
  availableWidth?: number,
) => {
  const currentSize = readMermaidSvgSize(currentMarkup);
  const wrappedSize = readMermaidSvgSize(wrappedMarkup);

  if (!currentSize || !wrappedSize) {
    return false;
  }

  const normalizedAvailableWidth =
    availableWidth && availableWidth > 0 ? availableWidth : null;
  const currentOverflowsViewport = normalizedAvailableWidth
    ? currentSize.width > normalizedAvailableWidth * 1.02
    : false;
  const wrappedOverflowsViewport = normalizedAvailableWidth
    ? wrappedSize.width > normalizedAvailableWidth * 1.02
    : false;
  const widthReduction = wrappedSize.width / currentSize.width;
  const currentAspect = currentSize.width / currentSize.height;
  const wrappedAspect = wrappedSize.width / wrappedSize.height;

  if (currentOverflowsViewport && !wrappedOverflowsViewport) {
    return true;
  }

  if (currentOverflowsViewport && widthReduction < 1) {
    return true;
  }

  if (currentOverflowsViewport && widthReduction < 0.92) {
    return true;
  }

  return (
    currentAspect > 1.1 &&
    widthReduction < 0.98 &&
    wrappedAspect < currentAspect
  );
};

export const pickBestWrappedMermaidCandidate = (
  candidates: WrappedMermaidCandidate[],
  availableWidth?: number,
) => {
  const normalizedAvailableWidth =
    availableWidth && availableWidth > 0 ? availableWidth : null;

  const scored = candidates
    .map((candidate) => {
      const size = readMermaidSvgSize(candidate.markup);
      if (!size) {
        return null;
      }

      const overflows = normalizedAvailableWidth
        ? size.width > normalizedAvailableWidth * 1.02
        : false;

      return {
        ...candidate,
        height: size.height,
        overflows,
        overflowWidth:
          normalizedAvailableWidth && size.width > normalizedAvailableWidth
            ? size.width - normalizedAvailableWidth
            : 0,
        width: size.width,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is WrappedMermaidCandidate & {
        height: number;
        overflowWidth: number;
        overflows: boolean;
        width: number;
      } => candidate !== null,
    );

  if (scored.length === 0) {
    return null;
  }

  const fitting = scored
    .filter((candidate) => !candidate.overflows)
    .sort(
      (left, right) =>
        left.rowCount - right.rowCount ||
        right.width - left.width ||
        left.height - right.height,
    );
  if (fitting.length > 0) {
    return fitting[0];
  }

  return scored.sort(
    (left, right) =>
      left.overflowWidth - right.overflowWidth ||
      left.rowCount - right.rowCount ||
      right.width - left.width ||
      left.height - right.height,
  )[0];
};
