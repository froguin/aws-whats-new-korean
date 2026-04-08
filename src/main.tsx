import React from 'react';
import { createRoot } from 'react-dom/client';
import '@cloudscape-design/global-styles/index.css';
import fontCSS from './fonts.css?raw';
import App from './App';

// fonts.css를 CSS 번들 밖에서 주입 (esbuild base64 파싱 버그 우회)
const _fontStyle = document.createElement('style');
_fontStyle.textContent = fontCSS;
document.head.appendChild(_fontStyle);

createRoot(document.getElementById('root')!).render(<App />);
