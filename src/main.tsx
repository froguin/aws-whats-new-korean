import React from 'react';
import { createRoot } from 'react-dom/client';
// index.css 대신 index-base.css: 쓰지 않는 Open Sans(base64 약 180kB)를 빼고 Amazon Ember는 ./fonts.css로 불러온다.
import '@cloudscape-design/global-styles/index-base.css';
import './fonts.css';

import App from './App';

// 배포 직후 열려 있던 탭은 예전 청크 이름이 404가 될 수 있다. 한 번만 새로고침해 새 빌드를 받는다.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('chunk-reload')) return;
  sessionStorage.setItem('chunk-reload', '1');
  window.location.reload();
});

// 정상적으로 뜬 뒤에는 표시를 지워서, 다음 배포 때도 한 번 더 복구할 수 있게 한다.
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('chunk-reload'), 5000));

createRoot(document.getElementById('root')!).render(<App />);
