import { defineFunction } from '@aws-amplify/backend';

export const translator = defineFunction({
  name: 'translator',
  entry: './handler.js',
  timeoutSeconds: 600,
  memoryMB: 512,
  runtime: 22,
});
