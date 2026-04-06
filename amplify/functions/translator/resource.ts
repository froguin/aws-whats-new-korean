import { defineFunction } from '@aws-amplify/backend';

export const translator = defineFunction({
  name: 'translator',
  timeoutSeconds: 600,
  memoryMB: 512,
});
