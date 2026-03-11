import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './components/ui/ui.css';
import './features/conversations/styles/workspaceTree.css';
import './styles/index.css';
import './features/messages/styles/message.css';

// 전역 에러 핸들러 추가 (무해한 에러 필터링)
window.onerror = (message, source, lineno, colno, error) => {
  const msg = String(message);
  // Monaco 에디터 및 LSP 클라이언트의 양성 에러(Canceled, Timeout)는 무시
  if (msg.includes('Canceled') || msg.includes('Stopping the server timed out')) {
    return true; // 에러 전파 중단 (오버레이 방지)
  }
  console.error('[GPTViewer Renderer Error]', { message, source, lineno, colno, error });
};

window.onunhandledrejection = (event) => {
  const reason = String(event.reason);
  if (reason.includes('Canceled') || reason.includes('Stopping the server timed out')) {
    event.preventDefault(); // 에러 전파 중단
    return;
  }
  console.error('[GPTViewer Promise Rejection]', event.reason);
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />,
);
