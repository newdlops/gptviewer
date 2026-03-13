import React, { useState, KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/Button';

type ConversationInputProps = {
  onSendMessage: (message: string) => void;
  sendMessageStatus?: 'idle' | 'sending' | 'receiving';
  isRefreshing?: boolean;
  disabled?: boolean;
  modelConfig?: any;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
};

export function ConversationInput({ 
  onSendMessage, 
  sendMessageStatus, 
  isRefreshing, 
  disabled, 
  modelConfig,
  selectedModel,
  onModelChange 
}: ConversationInputProps) {
  const [message, setMessage] = useState('');

  const modelOptions = (() => {
    const options = [];
    if (modelConfig?.juices?.web) {
      Object.entries(modelConfig.juices.web as Record<string, string>).forEach(([model, juice]) => {
        options.push({
          label: juice === 'extended' ? `${model} (Thinking)` : model,
          value: model,
        });
      });
    }
    return options;
  })();

  const getButtonText = () => {
    if (sendMessageStatus === 'sending') return '...';
    if (sendMessageStatus === 'receiving') return '...';
    if (isRefreshing) return '...';
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
    <div className="conversation-input" style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', padding: '15px 20px', borderTop: '1px solid var(--border-soft)' }}>
      <textarea
        className="conversation-input__textarea"
        style={{ flex: 1, minHeight: '44px', maxHeight: '160px', padding: '10px 14px', borderRadius: '12px', background: 'var(--input-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-soft)', resize: 'vertical' }}
        placeholder={disabled ? '처리 중...' : '메시지 입력 (Enter 전송)'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <div className="conversation-input__actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        {onModelChange && (
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled || modelOptions.length === 0}
            style={{ 
              background: 'var(--panel-bg-soft)', 
              color: 'var(--text-primary)', 
              border: '1px solid var(--border-soft)', 
              borderRadius: '8px', 
              padding: '6px 10px',
              fontSize: '0.85rem',
              cursor: modelOptions.length > 0 ? 'pointer' : 'wait',
              outline: 'none',
              maxWidth: '180px',
              opacity: modelOptions.length > 0 ? 1 : 0.6
            }}
          >
            <option value="auto">자동 (Auto)</option>
            {modelOptions.length > 0 ? (
              modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            ) : (
              <option disabled>모델 목록 로딩 중...</option>
            )}
          </select>
        )}
        <Button
          className="conversation-input__send"
          variant="primary"
          onClick={handleSend}
          disabled={!message.trim() || disabled || isRefreshing}
          style={{ height: '36px', borderRadius: '8px', padding: '0 16px', fontWeight: 'bold' }}
        >
          {getButtonText()}
        </Button>
      </div>
    </div>
  );
}
