import React from 'react';
import { createRoot } from 'react-dom/client';
// index.css 대신 index-base.css: 쓰지 않는 Open Sans(base64 약 180kB)를 빼고 Amazon Ember는 ./fonts.css로 불러온다.
import '@cloudscape-design/global-styles/index-base.css';
import './fonts.css';

import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
