import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const MODAL_STACK_BASE_Z_INDEX = 200;
let nextModalStackOrder = 0;

function allocateModalStackOrder() {
  nextModalStackOrder += 1;
  return nextModalStackOrder;
}

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
  const [stackOrder, setStackOrder] = useState(() => (isOpen ? allocateModalStackOrder() : 0));
  const wasOpenRef = useRef(isOpen);

  useLayoutEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStackOrder(allocateModalStackOrder());
    }

    wasOpenRef.current = isOpen;
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
      style={{ zIndex: MODAL_STACK_BASE_Z_INDEX + stackOrder }}
    >
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
