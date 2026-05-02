import React from 'react';
import { createRoot } from 'react-dom/client';
import { AwsRum } from 'aws-rum-web';

import '@cloudscape-design/global-styles/index.css';
import './fonts.css';

import App from './App';

// CloudWatch RUM
try {
  const appMonitorId = import.meta.env.VITE_RUM_APP_MONITOR_ID;
  const poolId = import.meta.env.VITE_RUM_IDENTITY_POOL_ID;
  if (appMonitorId && poolId && window.location.hostname !== 'localhost') {
    new AwsRum(appMonitorId, '1.0.0', 'ap-northeast-2', {
      sessionSampleRate: 1,
      identityPoolId: poolId,
      endpoint: 'https://dataplane.rum.ap-northeast-2.amazonaws.com',
      telemetries: ['performance', 'errors', 'http'],
      allowCookies: true,
      enableXRay: false,
    });
  }
} catch (e) {
  // RUM init failure should not block the app
}

createRoot(document.getElementById('root')!).render(<App />);
