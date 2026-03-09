import type { Conversation, WorkspaceNode } from '../../../types/chat';

const createInitialNodeMeta = (offsetMinutes: number) => {
  const timestamp = new Date(Date.now() - offsetMinutes * 60_000).toISOString();

  return {
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const initialConversations: Conversation[] = [
  {
    id: 'drafts',
    title: '문서 초안 검토',
    summary: '뷰어 셸과 콘텐츠 패널 설계',
    updatedAt: '방금 전',
    messages: [
      {
        id: 'drafts-1',
        role: 'assistant',
        sources: [],
        text: '작업 공간이 준비되었습니다. 왼쪽 드로어에는 대화 목록을 배치하고, 오른쪽에는 뷰어와 채팅을 함께 둘 수 있습니다.',
        timestamp: '10:12',
      },
      {
        id: 'drafts-2',
        role: 'user',
        sources: [],
        text: 'GPT 데스크톱 레이아웃에 가깝게 유지하되, 나중에 문서 뷰어 패널을 붙일 공간은 확보해 주세요.',
        timestamp: '10:13',
      },
    ],
  },
  {
    id: 'research',
    title: '리서치 노트',
    summary: '추출한 문단과 요약 정리',
    updatedAt: '14분 전',
    messages: [
      {
        id: 'research-1',
        role: 'assistant',
        sources: [],
        text: '이 스레드는 나중에 파싱된 문서, 표, 주석을 오른쪽 뷰어 패널 안에서 바로 보여줄 수 있습니다.',
        timestamp: '09:58',
      },
    ],
  },
  {
    id: 'review',
    title: '디자인 검토',
    summary: '간격, 타이포그래피, 드로어 흐름',
    updatedAt: '1시간 전',
    messages: [
      {
        id: 'review-1',
        role: 'assistant',
        sources: [],
        text: '현재 셸은 소개용 랜딩 화면보다 실제 작업에 가까운 밀도 높은 데스크톱 레이아웃을 우선합니다.',
        timestamp: '09:01',
      },
    ],
  },
];

export const initialWorkspaceTree: WorkspaceNode[] = [
  {
    id: 'workspace-root-projects',
    meta: createInitialNodeMeta(0),
    name: '프로젝트',
    type: 'folder',
    children: [
      {
        id: 'workspace-conversation-drafts',
        meta: createInitialNodeMeta(1),
        type: 'conversation',
        conversationId: 'drafts',
      },
      {
        id: 'workspace-root-research',
        meta: createInitialNodeMeta(2),
        name: '리서치',
        type: 'folder',
        children: [
          {
            id: 'workspace-conversation-research',
            meta: createInitialNodeMeta(3),
            type: 'conversation',
            conversationId: 'research',
          },
        ],
      },
    ],
  },
  {
    id: 'workspace-root-design',
    meta: createInitialNodeMeta(4),
    name: '디자인',
    type: 'folder',
    children: [
      {
        id: 'workspace-conversation-review',
        meta: createInitialNodeMeta(5),
        type: 'conversation',
        conversationId: 'review',
      },
    ],
  },
  {
    id: 'workspace-root-imports',
    meta: createInitialNodeMeta(6),
    name: '대화',
    type: 'folder',
    children: [],
  },
];
