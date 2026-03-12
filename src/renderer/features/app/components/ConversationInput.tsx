import React, { useState, KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/Button';

type ConversationInputProps = {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
};

export function ConversationInput({ onSendMessage, disabled }: ConversationInputProps) {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="conversation-input">
      <textarea
        className="conversation-input__textarea"
        placeholder={disabled ? '메시지를 전송하는 중입니다...' : '메시지를 입력하세요 (Enter로 전송, Shift+Enter로 줄바꿈)'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <Button
        className="conversation-input__send"
        variant="primary"
        onClick={handleSend}
        disabled={!message.trim() || disabled}
      >
        {disabled ? '전송 중' : '전송'}
      </Button>
    </div>
  );
}
