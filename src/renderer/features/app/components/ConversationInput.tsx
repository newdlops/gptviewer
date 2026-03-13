import React, { useState, KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/Button';

type ConversationInputProps = {
  onSendMessage: (message: string) => void;
  sendMessageStatus?: 'idle' | 'sending' | 'receiving';
  isRefreshing?: boolean;
  disabled?: boolean;
};

export function ConversationInput({ onSendMessage, sendMessageStatus, isRefreshing, disabled }: ConversationInputProps) {
  const [message, setMessage] = useState('');

  const getButtonText = () => {
    if (sendMessageStatus === 'sending') return '전송 중...';
    if (sendMessageStatus === 'receiving') return '응답 수신 중...';
    if (isRefreshing) return '새로고침 중...';
    return '전송';
  };

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
        placeholder={disabled ? '작업을 처리하는 중입니다...' : '메시지를 입력하세요 (Enter로 전송, Shift+Enter로 줄바꿈)'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <Button
        className="conversation-input__send"
        variant="primary"
        onClick={handleSend}
        disabled={!message.trim() || disabled || isRefreshing}
      >
        {getButtonText()}
      </Button>
    </div>
  );
}
