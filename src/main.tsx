import React from 'react';
import { createRoot } from 'react-dom/client';

// 1. Cloudscape 글로벌 스타일을 먼저 로드
import '@cloudscape-design/global-styles/index.css';

// 2. 커스텀 폰트를 이후 로드하여 Cloudscape 기본 Open Sans를 덮어씀
import './fonts.css';

import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
