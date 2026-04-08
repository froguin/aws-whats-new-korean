import React from 'react';
import { createRoot } from 'react-dom/client';
import '@cloudscape-design/global-styles/index.css';
import '@cloudscape-design/components/styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
