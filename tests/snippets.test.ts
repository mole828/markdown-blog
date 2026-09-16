import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractSnippets, verify } from '../scripts/verify-snippets.mjs';

test('Markdown AST skips example fences and preserves three execution modes', () => {
  const text = '````markdown\n```kotlin\nnot executed\n```\n````\n\n```kotlin\nprintln(1)\n```\n\n~~~kotlin file\nfun main() {}\n~~~\n\n```kotlin test\nclass Test {}\n```';
  const blocks = extractSnippets(text);
  assert.deepEqual(blocks.map(block => block.mode), ['snippet','file','test']);
  assert.equal(blocks[0].start, 7);
  assert.equal(blocks[0].source, 'println(1)');
});
test('cursor selection executes only its block; failure produces nonzero result', async () => {
  const dir = await mkdtemp(join(tmpdir(),'blog-snippets-'));
  try {
    const file = join(dir, 'space name.md');
    await writeFile(file, '```kotlin\nprintln(1)\n```\n\n```kotlin test\nclass Test {}\n```');
    let calls = 0;
    const exit = await verify(file, 6, async (source: string, mode: string, endpoint: string) => {
      calls++;
      assert.equal(source,'class Test {}'); assert.equal(mode,'test'); assert.match(endpoint,/\/test$/);
      return {text:'test failed', failed:true};
    });
    assert.equal(calls,1); assert.equal(exit,1);
    await assert.rejects(verify(file,4,async()=>{throw new Error('must not execute');}), /光标/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
