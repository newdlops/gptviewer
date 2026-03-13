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
    <div className="conversation-input" style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', padding: '15px 20px', borderTop: '1px solid var(--border-soft)' }}>
      <textarea
        className="conversation-input__textarea"
        style={{ flex: 1, minHeight: '44px', maxHeight: '160px', padding: '10px 14px', borderRadius: '12px', background: 'var(--input-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-soft)', resize: 'vertical' }}
        placeholder={disabled ? '처리 중...' : '메시지 입력 (Enter 전송)'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <div className="conversation-input__actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px', minWidth: '130px' }}>
        {onModelChange && (
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled || modelOptions.length === 0}
            style={{ 
              width: '100%',
              appearance: 'none',
              background: 'transparent', 
              color: 'var(--text-muted)', 
              border: '1px solid transparent', 
              borderRadius: '8px', 
              padding: '6px 24px 6px 12px',
              fontSize: '0.85rem',
              cursor: modelOptions.length > 0 ? 'pointer' : 'wait',
              outline: 'none',
              opacity: modelOptions.length > 0 ? 1 : 0.6,
              backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 6px center',
              backgroundSize: '14px',
              transition: 'color 0.2s, background-color 0.2s, border-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'color-mix(in srgb, var(--panel-bg-soft) 40%, transparent)';
              e.currentTarget.style.borderColor = 'var(--border-soft)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            <option value="auto" style={{ color: 'var(--text-primary)', background: 'var(--panel-bg)' }}>자동 (Auto)</option>
            {modelOptions.length > 0 ? (
              modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ color: 'var(--text-primary)', background: 'var(--panel-bg)' }}>
                  {opt.label}
                </option>
              ))
            ) : (
              <option disabled style={{ color: 'var(--text-primary)', background: 'var(--panel-bg)' }}>로딩 중...</option>
            )}
          </select>
        )}
        <Button
          className="conversation-input__send"
          variant="primary"
          onClick={handleSend}
          disabled={!message.trim() || disabled || isRefreshing}
          style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '0 16px', fontWeight: 'bold' }}
        >
          {getButtonText()}
        </Button>
      </div>
    </div>
  );
}
