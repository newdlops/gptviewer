import React, { memo } from 'react';
import type { Message } from '../../../types/chat';

export type SectionAnchor = {
  id: string;
  label: string;
  role: Message['role'];
  start: number;
};

export type SectionOutlineProps = {
  onSectionJump: (section: SectionAnchor) => void;
  sections: SectionAnchor[];
};

export const SectionOutline = memo(function SectionOutlineComponent({
  onSectionJump,
  sections,
}: SectionOutlineProps) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <aside className="message-list__outline-column" aria-label="대화 목차">
      <div className="message-list__outline-dock">
        <button
          className="message-list__outline-tab"
          type="button"
          aria-label="대화 목차"
        >
          목차
        </button>
        <div className="message-list__outline-panel">
          <div className="message-list__outline-header">대화 목차</div>
          <div className="message-list__outline-list">
            {sections.map((section, index) => (
              <button
                key={section.id}
                className={`message-list__outline-item${
                  section.role === 'user'
                    ? ' message-list__outline-item--user'
                    : ''
                }`}
                type="button"
                onClick={(event) => {
                  const button = event.currentTarget;
                  onSectionJump(section);
                  window.requestAnimationFrame(() => {
                    button.blur();
                  });
                }}
              >
                <span className="message-list__outline-index">{index + 1}</span>
                <span className="message-list__outline-copy">
                  {section.role === 'user' ? (
                    <span className="message-list__outline-tag">질문</span>
                  ) : null}
                  <span className="message-list__outline-label">
                    {section.label}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
});
