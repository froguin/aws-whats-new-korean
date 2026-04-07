import { defineFunction } from '@aws-amplify/backend';

export const api = defineFunction({
  name: 'api',
  entry: './handler.js',
  timeoutSeconds: 30,
  memoryMB: 256,
  runtime: 22,
  bundling: { externalPackages: ['@aws-sdk/*', '@smithy/*'] },
});
