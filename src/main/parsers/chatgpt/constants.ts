export const CITATION_TOKEN_PATTERN = /\uE200(?:cite|filecite|navlist)\uE202[\s\S]*?\uE201/g;
export const INLINE_CITATION_TOKEN_PATTERN = /\uE200(filecite|cite|navlist)\uE202([^\uE202\uE201]+)(?:\uE202([^\uE201]+))?\uE201/g;

export const NON_IMPORTABLE_CONTENT_TYPES = new Set([
  'model_editable_context',
  'reasoning_recap',
  'thoughts',
]);

export const MERMAID_SOURCE_PATTERN = /(^|\n)\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|xychart|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|block-beta|architecture-beta)\b|-->|\bsubgraph\b/;
export const LANGUAGE_FENCE_PATTERN = /```([\w#+.-]+)?\n[\s\S]*?```/g;
export const LANGUAGE_ONLY_PATTERN = /^(mermaid|java|javascript|typescript|python|json|yaml|xml|html|sql|bash|shell|tsx|jsx|css|markdown|svg)$/i;
export const MERMAID_LOADING_TEXT_PATTERN = /^(?:mermaid\s*)?(?:다이어그램\s*)?불러오는 중(?:\.{3}|…)?$/i;
export const HTTP_HEADER_CODE_PATTERN = /^https?:\/\/|^httphttp\/1\.[01]\s+\d{3}|^http\/1\.[01]\s+\d{3}/i;
export const IMAGE_CONTENT_HINT_PATTERN = /(image|img|photo|picture|thumbnail|preview|avatar|asset_pointer)/i;
export const IMAGE_CONTENT_TYPE_PATTERN = /(image|image_asset_pointer|multimodal_image|input_image|output_image)/i;
export const IMAGE_MIME_TYPE_PATTERN = /^image\//i;
export const IMAGE_URL_PATTERN = /^(data:image\/[a-z0-9.+-]+;base64,|https?:\/\/.+\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$|https?:\/\/(?:[^/?#]+\.)?oaiusercontent\.com\/.+)/i;
export const FILE_SERVICE_POINTER_PATTERN = /^file-service:\/\/(.+)/i;
export const SEDIMENT_POINTER_PATTERN = /^sediment:\/\/(file_[a-z0-9_-]+)/i;
export const WIDGET_STATE_MARKER = 'The latest state of the widget is:';
export const DEEP_RESEARCH_APP_PATH_PATTERN = /^\/Deep Research App\//i;
export const DEEP_RESEARCH_CONNECTOR_PATTERN = /implicit_link::connector_openai_deep_research|connector_openai_deep_research/i;
