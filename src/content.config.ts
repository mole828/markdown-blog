import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
export const collections = {
  posts: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './content/posts', deferRender: true }),
    schema: z.object({ title: z.string(), date: z.coerce.date(), description: z.string().default(''), tags: z.array(z.string()).default([]), draft: z.boolean().default(false) }),
  }),
};
