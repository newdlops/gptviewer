import type { ReactNode } from 'react';

type ModalProps = {
  ariaLabelledBy: string;
  children: ReactNode;
  eyebrow?: string;
  isOpen: boolean;
  onClose: () => void;
  title: string;
};

export function Modal({
  ariaLabelledBy,
  children,
  eyebrow,
  isOpen,
  onClose,
  title,
}: ModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            {eyebrow ? <p className="drawer__eyebrow">{eyebrow}</p> : null}
            <h2 id={ariaLabelledBy}>{title}</h2>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}
