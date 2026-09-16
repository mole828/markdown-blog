import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import runnable from './src/plugins/runnable.mjs';
export default defineConfig({ markdown: { processor: unified({ remarkPlugins: [runnable] }) } });
