import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './components/ui/ui.css';
import './features/conversations/styles/workspaceTree.css';
import './styles/index.css';
import './features/messages/styles/message.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />,
);
