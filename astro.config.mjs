import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import aws from 'astro-provider-aws';

export default defineConfig({
  output: 'server',
  adapter: aws(),
  integrations: [tailwind()],
});
