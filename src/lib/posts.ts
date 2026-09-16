import { getCollection } from 'astro:content';
export async function posts() {
  return (await getCollection('posts', ({ data }) => !data.draft)).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
export const postUrl = (id: string) => '/posts/' + id.split('/').map(encodeURIComponent).join('/') + '/';
export const tagUrl = (tag: string) => '/tags/' + encodeURIComponent(tag) + '/';
export const dateLabel = (date: Date) => date.toISOString().slice(0, 10);
