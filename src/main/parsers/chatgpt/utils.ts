import {
  INLINE_CITATION_TOKEN_PATTERN,
  CITATION_TOKEN_PATTERN,
  MERMAID_SOURCE_PATTERN,
  LANGUAGE_ONLY_PATTERN,
  IMAGE_CONTENT_HINT_PATTERN,
  IMAGE_CONTENT_TYPE_PATTERN,
  IMAGE_MIME_TYPE_PATTERN,
  IMAGE_URL_PATTERN,
  SEDIMENT_POINTER_PATTERN,
  FILE_SERVICE_POINTER_PATTERN,
  DEEP_RESEARCH_APP_PATH_PATTERN,
  DEEP_RESEARCH_CONNECTOR_PATTERN,
  MERMAID_LOADING_TEXT_PATTERN,
  HTTP_HEADER_CODE_PATTERN
} from './constants';

/**
 * RSC(React Server Components) 페이로드 문자열을 디코딩합니다.
 * 
 * @param value 디코딩할 문자열
 * @returns 디코딩된 문자열
 */
export const decodeRscPayload = (value: string): string => JSON.parse(`"${value}"`);

/**
 * 대화 제목에서 'ChatGPT - ', ' - ChatGPT' 등의 불필요한 브랜딩 문구를 제거하고 정리합니다.
 * 
 * @param title 원본 제목
 * @returns 정리된 제목
 */
export const sanitizeConversationTitle = (title: string): string =>
  title
    .replace(/^ChatGPT\s*-\s*/i, '')
    .replace(/\s*[|-]\s*ChatGPT$/i, '')
    .replace(/\s+[|·-]\s+OpenAI$/i, '')
    .trim() || 'ChatGPT 대화';

/**
 * 텍스트의 첫 번째 줄이 마크다운 H1(# ) 제목인 경우 해당 제목을 추출합니다.
 * 
 * @param text 분석할 텍스트
 * @returns 추출된 제목 또는 null
 */
export const extractHeadingTitle = (text: string): string | null => {
  const headingMatch = text.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }
  return null;
};

/**
 * 문자열이 JSON 객체 형태인 경우 파싱을 시도하여 레코드 객체를 반환합니다.
 * 
 * @param value 파싱할 문자열
 * @returns 파싱된 객체 또는 실패 시 null
 */
export const tryParseJsonRecord = (value: string): Record<string, unknown> | null => {
  const trimmedValue = value.trim();
  if (!trimmedValue.startsWith('{') || !trimmedValue.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * 텍스트가 Deep Research를 제어하기 위한 내부 페이로드인지 확인합니다.
 * 
 * @param value 확인할 텍스트
 * @returns 페이로드 여부
 */
export const isDeepResearchSteerPayloadText = (value: string): boolean => {
  const parsedRecord = tryParseJsonRecord(value);
  if (!parsedRecord) {
    return false;
  }

  const path = parsedRecord.path;
  const args = parsedRecord.args;

  return (
    typeof path === 'string' &&
    DEEP_RESEARCH_APP_PATH_PATTERN.test(path) &&
    DEEP_RESEARCH_CONNECTOR_PATTERN.test(path) &&
    typeof args === 'object' &&
    !!args
  );
};

/**
 * 메시지 텍스트를 사용자에게 보여주기 적합하도록 정규화합니다.
 * 인용 토큰 제거, 불필요한 공백 및 줄바꿈 정리 등을 수행합니다.
 * 
 * @param value 원본 텍스트
 * @returns 정규화된 텍스트
 */
export const normalizeMessageText = (value: string): string =>
  value
    .replace(
      INLINE_CITATION_TOKEN_PATTERN,
      (_match, citationType: string) =>
        citationType === 'filecite' ? '[파일 참조]' : ' ',
    )
    .replace(CITATION_TOKEN_PATTERN, '')
    .replace(/\r/g, '')
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment) => {
      // 코드 블록 내부는 공백 정규화에서 제외 (단, non-breaking space는 일반 공백으로 치환)
      if (/^(```|~~~)/.test(segment)) {
        return segment.replace(/\u00a0/g, ' ');
      }

      return segment
        .replace(/\u00a0/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/[ \f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    })
    .join('')
    .trim();

/**
 * 프로그래밍 언어 이름을 정규화합니다. (소문자화, 접두사 제거 등)
 * 
 * @param value 언어 이름
 * @returns 정규화된 언어 이름
 */
export const normalizeCodeLanguage = (value: string): string =>
  value.trim().toLowerCase().replace(/^language[-:_]?/i, '');

/**
 * HTML 특수 문자를 엔티티로 이스케이프합니다.
 * 
 * @param value 원본 문자열
 * @returns 이스케이프된 문자열
 */
export const escapeHtmlEntities = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * 객체 메타데이터로부터 해당 콘텐츠의 프로그래밍 언어를 추론합니다.
 * 
 * @param record 분석할 객체
 * @returns 추론된 언어 이름 또는 빈 문자열
 */
export const inferObjectLanguage = (record: Record<string, unknown>): string => {
  const directCandidates = [
    record.language,
    record.lang,
    record.syntax,
    record.format,
    record.mime_type,
    record.mimeType,
    record.file_type,
    record.fileType,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeCodeLanguage(candidate);
    }
  }

  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object') {
    const metadataRecord = metadata as Record<string, unknown>;
    const nestedLanguage = inferObjectLanguage(metadataRecord);
    if (nestedLanguage) {
      return nestedLanguage;
    }
  }

  return '';
};

/**
 * 문자열의 특징(줄바꿈, 특수기호, 키워드 등)을 기반으로 코드 블록인지 여부를 판단합니다.
 * 
 * @param value 확인할 문자열
 * @returns 코드 블록 여부
 */
export const looksLikeCodeBlock = (value: string): boolean => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  return (
    normalizedValue.includes('\n') ||
    /[{};<>]/.test(normalizedValue) ||
    normalizedValue.includes('=>') ||
    normalizedValue.includes('def ') ||
    normalizedValue.includes('class ') ||
    normalizedValue.includes('function ') ||
    normalizedValue.includes('import ') ||
    normalizedValue.includes('SELECT ') ||
    normalizedValue.includes('<?xml')
  );
};

/**
 * 주어진 텍스트를 마크다운 코드 블록으로 렌더링해야 하는지 여부를 결정합니다.
 * 
 * @param value 텍스트 내용
 * @param language 언어 정보
 * @param contentType 콘텐츠 타입 정보
 * @returns 코드 블록 렌더링 여부
 */
export const shouldRenderAsCodeBlock = (
  value: string,
  language: string,
  contentType: string,
): boolean => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue.startsWith('```')) {
    return false;
  }

  if (language === 'mermaid') {
    return MERMAID_SOURCE_PATTERN.test(normalizedValue);
  }

  if (language && !LANGUAGE_ONLY_PATTERN.test(normalizedValue)) {
    return true;
  }

  return /code|source|snippet|svg|diagram/i.test(contentType) && looksLikeCodeBlock(normalizedValue);
};

/**
 * 텍스트를 마크다운 코드 펜스(```)로 감쌉니다.
 * 
 * @param value 감쌀 텍스트
 * @param language 언어 이름
 * @returns 코드 펜스가 적용된 문자열
 */
export const wrapCodeFence = (value: string, language: string): string => {
  const normalizedValue = value.trim();
  const normalizedLanguage = normalizeCodeLanguage(language);
  const escapedValue =
    normalizedLanguage === 'html'
      ? escapeHtmlEntities(normalizedValue)
      : normalizedValue;
  return `\`\`\`${normalizedLanguage}\n${escapedValue}\n\`\`\``;
};

/**
 * 레코드 객체에서 지정된 키들의 값을 문자열 배열로 수집합니다.
 * 
 * @param record 대상 객체
 * @param keys 수집할 키 목록
 * @returns 수집된 문자열 배열
 */
export const collectRecordStrings = (
  record: Record<string, unknown>,
  keys: string[],
): string[] =>
  keys.flatMap((key) => {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is string => typeof entry === 'string' && !!entry.trim(),
      );
    }
    return [];
  });

/**
 * 객체 트리를 재귀적으로 순회하며 모든 문자열 리프(leaf) 노드들의 값을 수집합니다.
 * 
 * @param value 대상 데이터
 * @param visited 순환 참조 방지를 위한 Set
 * @returns 수집된 문자열 배열
 */
export const collectStringLeaves = (
  value: unknown,
  visited = new WeakSet<object>(),
): string[] => {
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringLeaves(entry, visited));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (visited.has(value)) {
    return [];
  }
  visited.add(value);

  return Object.values(value as Record<string, unknown>).flatMap((entry) =>
    collectStringLeaves(entry, visited),
  );
};

/**
 * 키 이름이 이미지와 관련될 가능성이 높은지 확인합니다.
 * 
 * @param key 확인할 키 이름
 * @returns 이미지 관련 여부
 */
export const isLikelyImageKey = (key: string): boolean =>
  IMAGE_CONTENT_HINT_PATTERN.test(key);

/**
 * 이미지 URL을 정규화합니다. (프로토콜 보완 등)
 * 
 * @param value URL 문자열
 * @returns 정규화된 URL
 */
export const normalizeRenderableImageUrl = (value: string): string => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  if (trimmedValue.startsWith('//')) {
    return `https:${trimmedValue}`;
  }

  return trimmedValue;
};

/**
 * 문자열이 렌더링 가능한 이미지 URL 형식인지 확인합니다.
 * 
 * @param value 확인할 문자열
 * @returns 이미지 URL 여부
 */
export const isRenderableImageUrl = (value: string): boolean =>
  IMAGE_URL_PATTERN.test(normalizeRenderableImageUrl(value));

/**
 * 객체의 속성들을 분석하여 해당 객체가 이미지 데이터를 포함하고 있을 가능성을 판단합니다.
 * 
 * @param record 확인할 객체
 * @param parentContext 부모가 이미 이미지 컨텍스트인지 여부
 * @returns 이미지 컨텍스트 여부
 */
export const isLikelyImageContext = (
  record: Record<string, unknown>,
  parentContext: boolean,
): boolean => {
  if (parentContext) {
    return true;
  }

  const contentType = String(record.content_type ?? record.type ?? record.kind ?? '');
  if (IMAGE_CONTENT_TYPE_PATTERN.test(contentType)) {
    return true;
  }

  const mimeTypeCandidates = [
    record.mime_type,
    record.mimeType,
    record.file_type,
    record.fileType,
  ];

  if (
    mimeTypeCandidates.some(
      (candidate) =>
        typeof candidate === 'string' &&
        IMAGE_MIME_TYPE_PATTERN.test(candidate.trim().toLowerCase()),
    )
  ) {
    return true;
  }

  return Object.keys(record).some((key) => isLikelyImageKey(key));
};

/**
 * 데이터 구조 내부에서 이미지 관련 파트(마크다운 이미지 태그 등)를 모두 수집합니다.
 * 
 * @param value 대상 데이터
 * @param parentContext 부모 컨텍스트가 이미지인지 여부
 * @param visited 순환 참조 방지
 * @returns 수집된 이미지 마크다운 배열
 */
export const collectImageParts = (
  value: unknown,
  parentContext = false,
  visited = new WeakSet<object>(),
): string[] => {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    const normalizedValue = normalizeRenderableImageUrl(value);
    if (isRenderableImageUrl(normalizedValue)) {
      return [`![image](${normalizedValue})`];
    }

    const sedimentPointerMatch = normalizedValue.match(SEDIMENT_POINTER_PATTERN);
    if (sedimentPointerMatch?.[1]) {
      return [`![image](sediment://${sedimentPointerMatch[1]})`];
    }

    const pointerMatch = normalizedValue.match(FILE_SERVICE_POINTER_PATTERN);
    if (pointerMatch?.[1]) {
      return [`[이미지 첨부: ${pointerMatch[1]}]`];
    }

    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectImageParts(entry, parentContext, visited));
  }

  if (typeof value !== 'object') {
    return [];
  }

  if (visited.has(value)) {
    return [];
  }
  visited.add(value);

  const record = value as Record<string, unknown>;
  const imageContext = isLikelyImageContext(record, parentContext);
  const imageParts: string[] = [];

  Object.entries(record).forEach(([key, entry]) => {
    if (typeof entry === 'string') {
      const normalizedEntry = normalizeRenderableImageUrl(entry);
      if (isRenderableImageUrl(normalizedEntry) && (imageContext || isLikelyImageKey(key))) {
        imageParts.push(`![image](${normalizedEntry})`);
        return;
      }

      const pointerMatch = normalizedEntry.match(FILE_SERVICE_POINTER_PATTERN);
      if (
        pointerMatch?.[1] &&
        (imageContext || isLikelyImageKey(key) || key === 'asset_pointer')
      ) {
        imageParts.push(`[이미지 첨부: ${pointerMatch[1]}]`);
      }

      return;
    }

    imageParts.push(
      ...collectImageParts(
        entry,
        imageContext || isLikelyImageKey(key),
        visited,
      ),
    );
  });

  return imageParts;
};

/**
 * 여러 개의 코드 후보 문자열 중 가장 적절한 것을 선택합니다.
 * 
 * @param candidates 코드 후보 배열
 * @param language 언어 정보
 * @param contentType 콘텐츠 타입 정보
 * @returns 선택된 코드 문자열
 */
export const chooseBestCodeCandidate = (
  candidates: string[],
  language: string,
  contentType: string,
): string => {
  const sanitizedCandidates = candidates
    .map((candidate) => candidate.trim())
    .filter(
      (candidate) =>
        !!candidate &&
        !LANGUAGE_ONLY_PATTERN.test(candidate) &&
        !MERMAID_LOADING_TEXT_PATTERN.test(candidate) &&
        !HTTP_HEADER_CODE_PATTERN.test(candidate),
    );

  if (language === 'mermaid') {
    return (
      sanitizedCandidates.find((candidate) => MERMAID_SOURCE_PATTERN.test(candidate)) ??
      ''
    );
  }

  return (
    sanitizedCandidates.find((candidate) =>
      shouldRenderAsCodeBlock(candidate, language, contentType),
    ) ??
    sanitizedCandidates.sort((left, right) => right.length - left.length)[0] ??
    ''
  );
};

/**
 * 대화의 특정 파트(content 등)를 분석하여 렌더링 가능한 텍스트 배열로 변환합니다.
 * 이미지, 코드 블록, 일반 텍스트 등을 추출하여 구성합니다.
 * 
 * @param value 분석할 데이터
 * @returns 렌더링 가능한 문자열 배열
 */
export const renderConversationPart = (value: unknown): string[] => {
  if (typeof value === 'string') {
    if (!value.trim() || isDeepResearchSteerPayloadText(value)) {
      return [];
    }
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => renderConversationPart(entry));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const contentType = String(record.content_type ?? record.type ?? record.kind ?? '');
  const language = inferObjectLanguage(record);
  const imageParts = collectImageParts(record);
  if (imageParts.length > 0) {
    return [...new Set(imageParts)];
  }

  const primaryCodeCandidates = collectRecordStrings(record, [
    'code',
    'source',
    'source_text',
    'sourceText',
    'raw_code',
    'rawCode',
    'markdown',
    'html',
    'value',
    'text',
  ]);

  const deepLeafCandidates =
    language || /code|source|snippet|svg|diagram/i.test(contentType)
      ? collectStringLeaves(record)
      : [];

  const codeCandidate = chooseBestCodeCandidate(
    [...primaryCodeCandidates, ...deepLeafCandidates],
    language,
    contentType,
  );
  if (codeCandidate) {
    return [wrapCodeFence(codeCandidate, language || 'text')];
  }

  const nestedParts = [
    ...renderConversationPart(record.text),
    ...renderConversationPart(record.content),
    ...renderConversationPart(record.parts),
    ...renderConversationPart(record.value),
    ...renderConversationPart(record.markdown),
    ...renderConversationPart(record.body),
    ...renderConversationPart(record.children),
  ];

  const uniqueParts: string[] = [];
  nestedParts.forEach((part) => {
    if (part && uniqueParts[uniqueParts.length - 1] !== part) {
      uniqueParts.push(part);
    }
  });

  return uniqueParts;
};

