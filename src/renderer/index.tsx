import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './components/ui/ui.css';
import './features/conversations/styles/workspaceTree.css';
import './styles/index.css';
import './features/messages/styles/message.css';

// 전역 에러 핸들러 추가 (디버깅용)
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[GPTViewer Renderer Error]', { message, source, lineno, colno, error });
};

window.onunhandledrejection = (event) => {
  console.error('[GPTViewer Promise Rejection]', event.reason);
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />,
);
