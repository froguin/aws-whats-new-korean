import React from 'react';
import { createRoot } from 'react-dom/client';

// 1. 커스텀 폰트를 먼저 로드 (Amazon Ember + Noto Sans KR)
import fontCSS from './fonts.css?raw';
const style = document.createElement('style');
style.textContent = fontCSS;
document.head.prepend(style); // prepend로 가장 먼저 적용

// 2. Cloudscape 글로벌 스타일 (폰트 이후)
import '@cloudscape-design/global-styles/index.css';

import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
