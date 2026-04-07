import { defineFunction } from '@aws-amplify/backend';

export const api = defineFunction({
  name: 'api',
  timeoutSeconds: 30,
  memoryMB: 256,
  runtime: 20,
});
