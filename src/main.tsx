import React from 'react';
import { createRoot } from 'react-dom/client';

// 1. 커스텀 폰트 (@font-face 선언)
import fontCSS from './fonts.css?raw';
const style = document.createElement('style');
style.textContent = fontCSS;
document.head.prepend(style);

// 2. Cloudscape 글로벌 스타일
import '@cloudscape-design/global-styles/index.css';

// 3. Cloudscape 공식 theming API로 폰트 오버라이드
import { applyTheme } from '@cloudscape-design/components/theming';
applyTheme({
  theme: {
    tokens: {
      fontFamilyBase: '"Amazon Ember", "Noto Sans KR", "Helvetica Neue", Roboto, Arial, sans-serif',
    },
  },
});

import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
