export const CHATGPT_SHARE_BUTTON_LABELS = [
  '공유',
  'Share',
  '공유하기',
  'Share link',
  '공유 링크',
  '링크 공유',
];

export const CHATGPT_SHARE_BUTTON_TEST_IDS = [
  'share-button',
];

export const CHATGPT_MORE_BUTTON_LABELS = [
  '더보기',
  '더 보기',
  'More',
  'More actions',
  'Open conversation options',
  'Open actions menu',
  'Open conversation menu',
  'Conversation options',
];

export const CHATGPT_MORE_BUTTON_TEST_IDS = [
  'conversation-actions-button',
  'conversation-options-button',
  'more-button',
];

export const CHATGPT_CLOSE_SIDEBAR_BUTTON_LABELS = [
  '사이드바 닫기',
  'Close sidebar',
  'Hide sidebar',
];

export const CHATGPT_OPEN_SIDEBAR_BUTTON_LABELS = [
  '사이드바 열기',
  'Open sidebar',
  'Show sidebar',
];

export const CHATGPT_PROJECTS_BUTTON_LABELS = [
  '프로젝트',
  'Projects',
];

export const CHATGPT_PROJECT_CHAT_LIST_SELECTORS = [
  '#radix-_r_3qt_-content-chats > div > div > section > ol',
  '[id$="-content-chats"] section ol',
  '[id*="content-chats"] section ol',
];

export const CHATGPT_UPDATE_AND_COPY_BUTTON_LABELS = [
  '링크하기',
  '링크 만들기',
  '링크 복사',
  '링크 복사하기',
  '공유 링크 복사',
  '업데이트 및 링크 복사',
  '업데이트 및 복사',
  'Update and Copy Link',
  'Update and Copy',
  'Create link',
  'Create Link',
  'Copy link',
  'Copy Link',
];

export const CHATGPT_UPDATE_AND_COPY_BUTTON_TEST_IDS = [
  'copy-link-button',
  'share-copy-link-button',
];

export const CHATGPT_COPY_SUCCESS_TEXT_MARKERS = [
  '클립보드에 복사되었다',
  '링크가 클립보드에 복사되었습니다',
  '링크가 복사되었습니다',
  'copied to clipboard',
  'link copied',
];

export const CHATGPT_LOGIN_URL_PATTERNS = [
  /auth\.openai\.com/i,
  /chatgpt\.com\/auth\//i,
  /chatgpt\.com\/login/i,
];

export const CHATGPT_LOGIN_TEXT_MARKERS = [
  'log in',
  'login',
  'continue with google',
  'continue with apple',
  '계속하려면 로그인',
  '로그인',
];

export const CHATGPT_CHALLENGE_TEXT_MARKERS = [
  'verify you are human',
  'captcha',
  'cloudflare',
  'human verification',
];

export const CHATGPT_SHARE_URL_PATTERN =
  /^https:\/\/chatgpt\.com\/share\/(?!(?:create|new)(?:[/?#]|$))[a-z0-9-]{16,}(?:[/?#].*)?$/i;
