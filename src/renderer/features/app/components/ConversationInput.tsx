import React, { useState, KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/Button';

type ConversationInputProps = {
  onSendMessage: (message: string, selectedModel?: string) => void;
  sendMessageStatus?: 'idle' | 'sending' | 'receiving';
  isRefreshing?: boolean;
  disabled?: boolean;
  availableModels?: string[];
};

export function ConversationInput({ onSendMessage, sendMessageStatus, isRefreshing, disabled, availableModels }: ConversationInputProps) {
  const [message, setMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Update selected model when available models are loaded for the first time
  React.useEffect(() => {
    if (availableModels && availableModels.length > 0 && !selectedModel) {
        // Prefer a "thinking" model or gpt-5 if available
        const defaultModel = availableModels.find(m => m.includes('thinking')) || availableModels[0];
        setSelectedModel(defaultModel);
    }
  }, [availableModels, selectedModel]);

  const getButtonText = () => {
    if (sendMessageStatus === 'sending') return '전송 중...';
    if (sendMessageStatus === 'receiving') return '응답 수신 중...';
    if (isRefreshing) return '새로고침 중...';
    return '전송';
  };

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim(), selectedModel || undefined);
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
      <div className="conversation-input__actions">
        {availableModels && availableModels.length > 0 && (
          <select
            className="conversation-input__model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={disabled}
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        )}
        <Button
          className="conversation-input__send"
          variant="primary"
          onClick={handleSend}
          disabled={!message.trim() || disabled || isRefreshing}
        >
          {getButtonText()}
        </Button>
      </div>
    </div>
  );
}
