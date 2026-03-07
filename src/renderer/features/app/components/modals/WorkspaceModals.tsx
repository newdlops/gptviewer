import type { FormEvent } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import type {
  ClearLocalWorkspaceState,
  CreateFolderState,
  DeleteFolderState,
  MoveFolderState,
  RenameConversationState,
  RenameFolderState,
} from '../../lib/appTypes';
import { formatFolderOptionLabel, getFolderSelectValue, parseFolderSelectValue } from '../../lib/appTypes';
import { WORKSPACE_ROOT_VALUE } from '../../../conversations/lib/workspaceTree';

type FolderOption = { depth: number; id: string; name: string };

type WorkspaceModalsProps = {
  allFolderOptions: FolderOption[];
  clearLocalWorkspaceState: ClearLocalWorkspaceState | null;
  createFolderState: CreateFolderState | null;
  deleteFolderState: DeleteFolderState | null;
  folderOperationError: string;
  moveFolderOptions: FolderOption[];
  moveFolderState: MoveFolderState | null;
  onClearLocalWorkspace: () => void;
  onCloseClearLocalWorkspace: () => void;
  onCloseCreateFolder: () => void;
  onCloseDeleteFolder: () => void;
  onCloseMoveFolder: () => void;
  onCloseRenameConversation: () => void;
  onCloseRenameFolder: () => void;
  onConfirmDeleteFolder: (folderId: string) => void;
  onCreateFolderSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCreateFolderStateChange: (nextState: CreateFolderState | null | ((current: CreateFolderState | null) => CreateFolderState | null)) => void;
  onMoveFolderStateChange: (nextState: MoveFolderState | null | ((current: MoveFolderState | null) => MoveFolderState | null)) => void;
  onMoveFolderSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRenameConversationStateChange: (
    nextState:
      | RenameConversationState
      | null
      | ((current: RenameConversationState | null) => RenameConversationState | null),
  ) => void;
  onRenameConversationSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRenameFolderStateChange: (nextState: RenameFolderState | null | ((current: RenameFolderState | null) => RenameFolderState | null)) => void;
  onRenameFolderSubmit: (event: FormEvent<HTMLFormElement>) => void;
  renameConversationState: RenameConversationState | null;
  renameFolderState: RenameFolderState | null;
};

export function WorkspaceModals({
  allFolderOptions,
  clearLocalWorkspaceState,
  createFolderState,
  deleteFolderState,
  folderOperationError,
  moveFolderOptions,
  moveFolderState,
  onClearLocalWorkspace,
  onCloseClearLocalWorkspace,
  onCloseCreateFolder,
  onCloseDeleteFolder,
  onCloseMoveFolder,
  onCloseRenameConversation,
  onCloseRenameFolder,
  onConfirmDeleteFolder,
  onCreateFolderStateChange,
  onCreateFolderSubmit,
  onMoveFolderStateChange,
  onMoveFolderSubmit,
  onRenameConversationStateChange,
  onRenameConversationSubmit,
  onRenameFolderStateChange,
  onRenameFolderSubmit,
  renameConversationState,
  renameFolderState,
}: WorkspaceModalsProps) {
  return (
    <>
      <Modal ariaLabelledBy="create-folder-modal-title" eyebrow="폴더 생성" isOpen={!!createFolderState} onClose={onCloseCreateFolder} title="새 폴더 만들기">
        <form className="modal__form" onSubmit={onCreateFolderSubmit}>
          <label className="modal__label" htmlFor="create-folder-name">폴더 이름</label>
          <input
            id="create-folder-name"
            className="modal__input"
            type="text"
            placeholder="새 폴더"
            value={createFolderState?.folderName ?? ''}
            onChange={(event) => onCreateFolderStateChange((current) => (current ? { ...current, folderName: event.target.value } : current))}
            autoFocus
          />
          <label className="modal__label" htmlFor="create-folder-parent">상위 폴더</label>
          <select
            id="create-folder-parent"
            className="modal__input"
            value={getFolderSelectValue(createFolderState?.parentFolderId ?? null)}
            onChange={(event) => onCreateFolderStateChange((current) => (current ? { ...current, parentFolderId: parseFolderSelectValue(event.target.value) } : current))}
          >
            <option value={WORKSPACE_ROOT_VALUE}>작업 공간 루트</option>
            {allFolderOptions.map((folderOption) => (
              <option key={folderOption.id} value={folderOption.id}>{formatFolderOptionLabel(folderOption.name, folderOption.depth)}</option>
            ))}
          </select>
          {folderOperationError ? <p className="modal__error" role="alert">{folderOperationError}</p> : null}
          <div className="modal__actions">
            <Button variant="secondary" onClick={onCloseCreateFolder}>취소</Button>
            <Button variant="primary" type="submit">만들기</Button>
          </div>
        </form>
      </Modal>

      <Modal ariaLabelledBy="move-folder-modal-title" eyebrow="폴더 이동" isOpen={!!moveFolderState} onClose={onCloseMoveFolder} title="폴더 이동">
        <form className="modal__form" onSubmit={onMoveFolderSubmit}>
          <p className="modal__hint"><strong>{moveFolderState?.folderName ?? ''}</strong> 폴더를 옮길 위치를 선택하세요.</p>
          <label className="modal__label" htmlFor="move-folder-destination">대상 위치</label>
          <select
            id="move-folder-destination"
            className="modal__input"
            value={getFolderSelectValue(moveFolderState?.destinationFolderId ?? null)}
            onChange={(event) => onMoveFolderStateChange((current) => (current ? { ...current, destinationFolderId: parseFolderSelectValue(event.target.value) } : current))}
          >
            <option value={WORKSPACE_ROOT_VALUE}>작업 공간 루트</option>
            {moveFolderOptions.map((folderOption) => (
              <option key={folderOption.id} value={folderOption.id}>{formatFolderOptionLabel(folderOption.name, folderOption.depth)}</option>
            ))}
          </select>
          <div className="modal__actions">
            <Button variant="secondary" onClick={onCloseMoveFolder}>취소</Button>
            <Button variant="primary" type="submit">이동</Button>
          </div>
        </form>
      </Modal>

      <Modal ariaLabelledBy="rename-folder-modal-title" eyebrow="폴더 이름 변경" isOpen={!!renameFolderState} onClose={onCloseRenameFolder} title="폴더 이름 변경">
        <form className="modal__form" onSubmit={onRenameFolderSubmit}>
          <label className="modal__label" htmlFor="rename-folder-name">새 폴더 이름</label>
          <input
            id="rename-folder-name"
            className="modal__input"
            type="text"
            placeholder="폴더 이름"
            value={renameFolderState?.nextName ?? ''}
            onChange={(event) => onRenameFolderStateChange((current) => (current ? { ...current, nextName: event.target.value } : current))}
            autoFocus
          />
          {folderOperationError ? <p className="modal__error" role="alert">{folderOperationError}</p> : null}
          <div className="modal__actions">
            <Button variant="secondary" onClick={onCloseRenameFolder}>취소</Button>
            <Button variant="primary" type="submit">변경</Button>
          </div>
        </form>
      </Modal>

      <Modal ariaLabelledBy="rename-conversation-modal-title" eyebrow="대화 이름 변경" isOpen={!!renameConversationState} onClose={onCloseRenameConversation} title="대화 제목 변경">
        <form className="modal__form" onSubmit={onRenameConversationSubmit}>
          <p className="modal__hint"><strong>{renameConversationState?.currentTitle ?? ''}</strong> 제목을 새 이름으로 바꿉니다.</p>
          <label className="modal__label" htmlFor="rename-conversation-title">새 대화 제목</label>
          <input
            id="rename-conversation-title"
            className="modal__input"
            type="text"
            placeholder="대화 제목"
            value={renameConversationState?.nextTitle ?? ''}
            onChange={(event) => onRenameConversationStateChange((current) => (current ? { ...current, nextTitle: event.target.value } : current))}
            autoFocus
          />
          {folderOperationError ? <p className="modal__error" role="alert">{folderOperationError}</p> : null}
          <div className="modal__actions">
            <Button variant="secondary" onClick={onCloseRenameConversation}>취소</Button>
            <Button variant="primary" type="submit">변경</Button>
          </div>
        </form>
      </Modal>

      <Modal ariaLabelledBy="delete-folder-modal-title" eyebrow="폴더 삭제" isOpen={!!deleteFolderState} onClose={onCloseDeleteFolder} title="폴더를 삭제할까요?">
        <div className="modal__form">
          <p className="modal__hint"><strong>{deleteFolderState?.folderName ?? ''}</strong> 폴더 아래의 하위 항목이 함께 삭제됩니다.</p>
          <div className="modal__warning">
            <strong>삭제 대상</strong>
            <span>하위 폴더 {deleteFolderState?.folderCount ?? 0}개</span>
            <span>대화 {deleteFolderState?.conversationCount ?? 0}개</span>
          </div>
          <div className="modal__actions">
            <Button variant="secondary" onClick={onCloseDeleteFolder}>취소</Button>
            <Button variant="danger" onClick={() => deleteFolderState && onConfirmDeleteFolder(deleteFolderState.folderId)}>하위 폴더 모두 삭제</Button>
          </div>
        </div>
      </Modal>

      <Modal ariaLabelledBy="clear-local-workspace-modal-title" eyebrow="로컬 작업 공간" isOpen={!!clearLocalWorkspaceState} onClose={onCloseClearLocalWorkspace} title="로컬 대화 내용을 비울까요?">
        <div className="modal__form">
          <p className="modal__hint">이 작업은 현재 기기의 로컬 폴더와 대화만 비웁니다. Google Drive의 원격 백업은 건드리지 않습니다.</p>
          <div className="modal__warning">
            <strong>삭제 대상</strong>
            <span>로컬 폴더 {clearLocalWorkspaceState?.folderCount ?? 0}개</span>
            <span>로컬 대화 {clearLocalWorkspaceState?.conversationCount ?? 0}개</span>
          </div>
          <p className="modal__hint">비운 뒤에는 자동 업로드를 잠시 막고, 다음 `지금 동기화`는 Drive 복원으로 동작합니다.</p>
          <div className="modal__actions">
            <Button variant="secondary" onClick={onCloseClearLocalWorkspace}>취소</Button>
            <Button variant="danger" onClick={onClearLocalWorkspace}>로컬 비우기</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
