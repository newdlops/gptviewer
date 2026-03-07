export type SourcePreviewImport = {
  description?: string;
  iconHref?: string;
  iconUrl?: string;
  publisher?: string;
  title?: string;
  url: string;
};

export type SourcePreviewSnapshot = {
  description?: string;
  headings: string[];
  iconHref?: string;
  iconUrl?: string;
  paragraphs: string[];
  publisher?: string;
  title?: string;
  url: string;
};

const CITATION_TOKEN_PATTERN = /\uE200(?:cite|navlist)\uE202[\s\S]*?\uE201/g;
const INLINE_CITATION_TEXT_PATTERN =
  /(?:^|[\s([{"'`])(?:cite\s*)?turn\d+(?:search|news|finance|sports|weather)?\d+(?=$|[\s)}"'`.,:;!?-])/gi;
const BRACKETED_CITATION_PATTERN = /\(\s*(?:cite\s*)?turn\d+[^)]*\)/gi;
const PRIVATE_USE_CHARACTER_PATTERN = /[\uE000-\uF8FF]/g;
const ISOLATED_CITATION_WORD_PATTERN = /\bcite\b/gi;
const PREVIEW_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'article',
  'articles',
  'blog',
  'com',
  'content',
  'doc',
  'docs',
  'help',
  'home',
  'how',
  'in',
  'is',
  'news',
  'of',
  'on',
  'openai',
  'page',
  'post',
  'posts',
  'share',
  'support',
  'the',
  'to',
  'us',
  'www',
]);
const GENERIC_SITE_TITLE_PATTERNS = [
  /\bhelp center\b/i,
  /\bsupport\b/i,
  /\bdocumentation\b/i,
  /\bdeveloper docs\b/i,
  /\bblog\b/i,
  /\bnews\b/i,
  /\bhome\b/i,
];

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export const cleanSourceText = (value: string): string =>
  decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(CITATION_TOKEN_PATTERN, '')
    .replace(BRACKETED_CITATION_PATTERN, '')
    .replace(INLINE_CITATION_TEXT_PATTERN, '')
    .replace(PRIVATE_USE_CHARACTER_PATTERN, '')
    .replace(ISOLATED_CITATION_WORD_PATTERN, '')
    .replace(/\s*[()[\]{}<>]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const getHostnameFallback = (sourceUrl: string): string => {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return sourceUrl;
  }
};

const normalizeComparableLabel = (value?: string): string =>
  (value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/www\./g, '')
    .replace(/[^a-z0-9가-힣]+/g, '');

const isGenericSiteTitle = (
  title?: string,
  publisher?: string,
  sourceUrl?: string,
): boolean => {
  const normalizedTitle = normalizeComparableLabel(title);
  if (!normalizedTitle) {
    return true;
  }

  const hostname = sourceUrl ? getHostnameFallback(sourceUrl) : '';
  if (
    normalizedTitle === normalizeComparableLabel(publisher) ||
    normalizedTitle === normalizeComparableLabel(hostname)
  ) {
    return true;
  }

  return GENERIC_SITE_TITLE_PATTERNS.some((pattern) => pattern.test(title ?? ''));
};

const resolveRelativeUrl = (
  candidate: string,
  baseUrl: string,
): string | undefined => {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
};

const extractMetaContent = (
  html: string,
  selectorPattern: RegExp,
): string | undefined => {
  const match = html.match(selectorPattern);
  return match?.[1]?.trim();
};

const extractAttributeValue = (tag: string, attributeName: string): string | undefined => {
  const pattern = new RegExp(
    `${attributeName}\\s*=\\s*["']([^"']+)["']`,
    'i',
  );
  return tag.match(pattern)?.[1]?.trim();
};

const isIcoLikeIcon = (href?: string, type?: string): boolean => {
  const normalizedHref = (href || '').toLowerCase();
  const normalizedType = (type || '').toLowerCase();

  return (
    normalizedType.includes('icon') ||
    normalizedType.includes('ico') ||
    normalizedHref.endsWith('.ico') ||
    normalizedHref.includes('.ico?')
  );
};

const scoreIconCandidate = ({
  href,
  rel,
  sizes,
  type,
}: {
  href?: string;
  rel?: string;
  sizes?: string;
  type?: string;
}): number => {
  const normalizedHref = (href || '').toLowerCase();
  const normalizedRel = (rel || '').toLowerCase();
  const normalizedType = (type || '').toLowerCase();
  const normalizedSizes = (sizes || '').toLowerCase();

  let score = 0;

  if (!href) {
    return -1;
  }

  if (normalizedRel.includes('apple-touch-icon')) {
    score += 120;
  }

  if (normalizedHref.endsWith('.svg') || normalizedType.includes('svg')) {
    score += 110;
  }

  if (normalizedHref.endsWith('.png') || normalizedType.includes('png')) {
    score += 100;
  }

  if (
    normalizedHref.endsWith('.webp') ||
    normalizedType.includes('webp') ||
    normalizedHref.endsWith('.jpg') ||
    normalizedHref.endsWith('.jpeg') ||
    normalizedType.includes('jpeg')
  ) {
    score += 80;
  }

  if (normalizedRel.includes('icon')) {
    score += 30;
  }

  if (normalizedSizes.includes('180x180')) {
    score += 25;
  } else if (normalizedSizes.includes('96x96') || normalizedSizes.includes('64x64')) {
    score += 20;
  } else if (normalizedSizes.includes('48x48') || normalizedSizes.includes('32x32')) {
    score += 15;
  } else if (normalizedSizes.includes('16x16')) {
    score += 10;
  }

  if (isIcoLikeIcon(href, type)) {
    score -= 100;
  }

  return score;
};

const extractIconHrefFromHtml = (html: string): string | undefined => {
  const candidates = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .map((tag) => ({
      href: extractAttributeValue(tag, 'href'),
      rel: extractAttributeValue(tag, 'rel'),
      sizes: extractAttributeValue(tag, 'sizes'),
      type: extractAttributeValue(tag, 'type'),
    }))
    .filter((candidate) => candidate.rel?.toLowerCase().includes('icon'))
    .filter((candidate) => candidate.href);

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates
    .sort((left, right) => scoreIconCandidate(right) - scoreIconCandidate(left))[0]
    ?.href;
};

const stripNonContentTags = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

const extractTagTexts = (html: string, pattern: RegExp): string[] =>
  [...html.matchAll(pattern)]
    .map((match) => cleanSourceText(match[1] ?? ''))
    .filter((text) => text.length > 0);

const uniqueTexts = (values: string[]): string[] => [...new Set(values)];

const isLikelyUsefulPreviewText = (value: string): boolean =>
  value.length >= 20 &&
  value.length <= 320 &&
  !/^(sign in|log in|subscribe|cookie|accept|menu|home|skip to content)$/i.test(
    value,
  ) &&
  !/^https?:\/\//i.test(value);

const tokenizeUrlCandidates = (sourceUrl: string): string[] => {
  try {
    const parsedUrl = new URL(sourceUrl);
    const rawSegments = [
      ...parsedUrl.pathname.split('/'),
      ...parsedUrl.search
        .replace(/^[?]/, '')
        .split(/[=&]/),
    ];

    return rawSegments
      .flatMap((segment) =>
        cleanSourceText(
          decodeURIComponent(segment)
            .replace(/[-_+]+/g, ' ')
            .replace(/\.[a-z0-9]+$/i, ''),
        )
          .toLowerCase()
          .split(/[^a-z0-9가-힣]+/),
      )
      .filter(
        (token) => token.length >= 2 && !PREVIEW_STOP_WORDS.has(token),
      );
  } catch {
    return [];
  }
};

const extractUrlTextCandidates = (
  sourceUrl: string,
): Pick<SourcePreviewImport, 'description' | 'title'> => {
  try {
    const parsedUrl = new URL(sourceUrl);
    const pathSegments = parsedUrl.pathname
      .split('/')
      .map((segment) =>
        cleanSourceText(
          decodeURIComponent(segment)
            .replace(/[-_+]+/g, ' ')
            .replace(/\.[a-z0-9]+$/i, ''),
        ),
      )
      .filter(
        (segment) =>
          segment.length >= 4 &&
          !/^\d+$/.test(segment) &&
          !/^(share|article|articles|blog|docs|doc|help|news|posts?)$/i.test(
            segment,
          ),
      );

    const queryCandidate = cleanSourceText(
      decodeURIComponent(
        parsedUrl.search.replace(/^[?]/, '').replace(/[=&]+/g, ' '),
      ),
    );
    const titleCandidate = [...pathSegments]
      .reverse()
      .find((segment) => segment.length >= 8);
    const descriptionCandidate = [queryCandidate, ...pathSegments].find(
      (segment) => segment.length >= 20,
    );

    return {
      description: descriptionCandidate || undefined,
      title: titleCandidate || undefined,
    };
  } catch {
    return {};
  }
};

const scoreCandidate = (
  candidate: string,
  urlTokens: string[],
  options: {
    idealMax: number;
    idealMin: number;
    preferShort?: boolean;
  },
): number => {
  const normalizedCandidate = candidate.toLowerCase();
  const candidateTokens = normalizedCandidate.split(/[^a-z0-9가-힣]+/);
  const overlapScore = urlTokens.reduce(
    (score, token) =>
      normalizedCandidate.includes(token) || candidateTokens.includes(token)
        ? score + 18
        : score,
    0,
  );
  const length = candidate.length;
  const idealMiddle = (options.idealMin + options.idealMax) / 2;
  const distancePenalty = Math.abs(length - idealMiddle) / 8;
  const shortBonus =
    options.preferShort && length <= options.idealMax
      ? Math.max(0, 18 - length / 8)
      : 0;
  const sentenceBonus = /[.!?]$/.test(candidate) ? 2 : 0;

  return overlapScore + shortBonus + sentenceBonus - distancePenalty;
};

const pickBestCandidate = (
  candidates: string[],
  urlTokens: string[],
  options: {
    idealMax: number;
    idealMin: number;
    preferShort?: boolean;
  },
): string | undefined =>
  uniqueTexts(candidates)
    .filter((candidate) => candidate.length >= options.idealMin / 2)
    .sort(
      (left, right) =>
        scoreCandidate(right, urlTokens, options) -
        scoreCandidate(left, urlTokens, options),
    )[0];

const extractHeuristicPreview = (
  html: string,
  sourceUrl: string,
): Pick<SourcePreviewImport, 'description' | 'title'> => {
  const sanitizedHtml = stripNonContentTags(html);
  const mainMatch = sanitizedHtml.match(
    /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i,
  );
  const bodyMatch = sanitizedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const contentRoot = mainMatch?.[2] ?? bodyMatch?.[1] ?? sanitizedHtml;
  const urlTokens = tokenizeUrlCandidates(sourceUrl);

  const headingCandidates = extractTagTexts(
    contentRoot,
    /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi,
  ).filter((text) => text.length <= 140);
  const paragraphCandidates = extractTagTexts(
    contentRoot,
    /<(?:p|li|blockquote)[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)>/gi,
  ).filter(isLikelyUsefulPreviewText);
  const urlCandidates = extractUrlTextCandidates(sourceUrl);

  const title =
    pickBestCandidate(headingCandidates, urlTokens, {
      idealMax: 92,
      idealMin: 8,
      preferShort: true,
    }) ??
    pickBestCandidate(paragraphCandidates, urlTokens, {
      idealMax: 96,
      idealMin: 18,
      preferShort: true,
    }) ??
    urlCandidates.title ??
    getHostnameFallback(sourceUrl);

  const description =
    pickBestCandidate(
      paragraphCandidates.filter((candidate) => candidate !== title),
      urlTokens,
      {
        idealMax: 220,
        idealMin: 48,
      },
    ) ??
    pickBestCandidate(
      headingCandidates.filter((candidate) => candidate !== title),
      urlTokens,
      {
        idealMax: 180,
        idealMin: 24,
      },
    ) ??
    urlCandidates.description;

  return {
    description,
    title,
  };
};

const buildPreviewFromCandidates = (
  headings: string[],
  paragraphs: string[],
  sourceUrl: string,
): Pick<SourcePreviewImport, 'description' | 'title'> => {
  const urlTokens = tokenizeUrlCandidates(sourceUrl);
  const urlCandidates = extractUrlTextCandidates(sourceUrl);

  const title =
    pickBestCandidate(headings, urlTokens, {
      idealMax: 92,
      idealMin: 8,
      preferShort: true,
    }) ??
    pickBestCandidate(paragraphs, urlTokens, {
      idealMax: 96,
      idealMin: 18,
      preferShort: true,
    }) ??
    urlCandidates.title ??
    getHostnameFallback(sourceUrl);

  const description =
    pickBestCandidate(
      paragraphs.filter((candidate) => candidate !== title),
      urlTokens,
      {
        idealMax: 220,
        idealMin: 48,
      },
    ) ??
    pickBestCandidate(
      headings.filter((candidate) => candidate !== title),
      urlTokens,
      {
        idealMax: 180,
        idealMin: 24,
      },
    ) ??
    urlCandidates.description;

  return {
    description,
    title,
  };
};

export const buildSourcePreviewFromSnapshot = (
  snapshot: SourcePreviewSnapshot,
): SourcePreviewImport => {
  const cleanedHeadings = uniqueTexts(
    snapshot.headings.map((value) => cleanSourceText(value)).filter((value) => value.length > 0),
  ).filter((text) => text.length <= 140);
  const cleanedParagraphs = uniqueTexts(
    snapshot.paragraphs
      .map((value) => cleanSourceText(value))
      .filter(isLikelyUsefulPreviewText),
  );
  const heuristicPreview = buildPreviewFromCandidates(
    cleanedHeadings,
    cleanedParagraphs,
    snapshot.url,
  );
  const cleanedPublisher = snapshot.publisher
    ? cleanSourceText(snapshot.publisher)
    : undefined;
  const cleanedTitle = snapshot.title ? cleanSourceText(snapshot.title) : undefined;
  const cleanedDescription = snapshot.description
    ? cleanSourceText(snapshot.description)
    : undefined;

  return {
    description:
      cleanedDescription && !isGenericSiteTitle(cleanedDescription, cleanedPublisher, snapshot.url)
        ? cleanedDescription
        : heuristicPreview.description,
    iconHref: snapshot.iconHref ? cleanSourceText(snapshot.iconHref) : undefined,
    iconUrl: snapshot.iconUrl
      ? resolveRelativeUrl(snapshot.iconUrl, snapshot.url)
      : undefined,
    publisher: cleanedPublisher,
    title:
      cleanedTitle && !isGenericSiteTitle(cleanedTitle, cleanedPublisher, snapshot.url)
        ? cleanedTitle
        : heuristicPreview.title,
    url: snapshot.url,
  };
};

export const buildSourcePreviewFromHtml = (
  html: string,
  sourceUrl: string,
): SourcePreviewImport => {
  const iconHref = extractIconHrefFromHtml(html);
  const title =
    extractMetaContent(
      html,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    extractMetaContent(
      html,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    extractMetaContent(html, /<title[^>]*>([^<]+)<\/title>/i);
  const description =
    extractMetaContent(
      html,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    extractMetaContent(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    extractMetaContent(
      html,
      /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
    );
  const publisher =
    extractMetaContent(
      html,
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    extractMetaContent(
      html,
      /<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i,
    );
  const heuristicPreview = extractHeuristicPreview(html, sourceUrl);

  return {
    description: description ? cleanSourceText(description) : heuristicPreview.description,
    iconHref: iconHref ? cleanSourceText(iconHref) : undefined,
    iconUrl: iconHref ? resolveRelativeUrl(iconHref, sourceUrl) : undefined,
    publisher: publisher ? cleanSourceText(publisher) : undefined,
    title: title ? cleanSourceText(title) : heuristicPreview.title,
    url: sourceUrl,
  };
};
