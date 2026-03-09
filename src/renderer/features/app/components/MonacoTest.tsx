import React, { useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';

// jsdelivr가 차단되는 환경을 대비해 unpkg CDN을 시도합니다.
loader.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.43.0/min/vs' } });

export function MonacoTest() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999 }}>
      {!isOpen ? (
        <button 
          onClick={() => setIsOpen(true)}
          style={{ padding: '10px 20px', background: '#007ACC', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
        >
          Open Monaco Test
        </button>
      ) : (
        <div style={{ width: '600px', height: '400px', background: 'white', border: '1px solid #ccc', borderRadius: '8px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px', background: '#eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold', color: 'black' }}>Monaco Editor Standalone Test</span>
            <button onClick={() => setIsOpen(false)} style={{ cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ flex: 1 }}>
            <Editor
              height="100%"
              defaultLanguage="java"
              defaultValue="// Hello Monaco!"
              options={{ minimap: { enabled: false } }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
