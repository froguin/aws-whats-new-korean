import { defineFunction } from '@aws-amplify/backend';

export const rssCollector = defineFunction({
  name: 'rss-collector',
  entry: './handler.js',
  schedule: 'every 15m',
  timeoutSeconds: 300,
  memoryMB: 256,
  runtime: 22,
});
