import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRust } from '../src/lib/runners.ts';

async function withMockFetch(mock: typeof fetch, action: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await action();
  } finally {
    globalThis.fetch = original;
  }
}

test('Rust runner sends the Playground protocol and combines successful output', async () => {
  const signal = new AbortController().signal;
  await withMockFetch(async (input, init) => {
    assert.equal(input, 'https://play.rust-lang.org/execute');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.signal, signal);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      channel: 'stable', mode: 'debug', edition: '2021', crateType: 'bin',
      tests: false, code: 'fn main() { println!("hello"); }', backtrace: false,
    });
    return Response.json({ success: true, stdout: 'hello', stderr: 'warning' });
  }, async () => {
    assert.deepEqual(await runRust('fn main() { println!("hello"); }', 'https://play.rust-lang.org/execute', signal), {
      text: 'hello\nwarning', failed: false,
    });
  });
});

test('Rust runner returns compiler errors as a failed execution', async () => {
  await withMockFetch(async () => Response.json({ success: false, stdout: '', stderr: 'error: expected `;`' }), async () => {
    assert.deepEqual(await runRust('fn main() {}', 'https://play.rust-lang.org/execute', new AbortController().signal), {
      text: 'error: expected `;`', failed: true,
    });
  });
});

test('Rust runner marks successful empty output clearly', async () => {
  await withMockFetch(async () => Response.json({ success: true, stdout: '', stderr: '' }), async () => {
    assert.deepEqual(await runRust('', 'https://play.rust-lang.org/execute', new AbortController().signal), {
      text: '（无输出）', failed: false,
    });
  });
});

test('Rust runner rejects responses with an invalid shape', async () => {
  for (const payload of [null, {}, { success: 'true', stdout: '', stderr: '' }, { success: true, stdout: 1, stderr: '' }]) {
    await withMockFetch(async () => Response.json(payload), async () => {
      await assert.rejects(runRust('', 'https://play.rust-lang.org/execute', new AbortController().signal), /无法识别的结果/);
    });
  }
});

test('Rust runner surfaces HTTP errors', async () => {
  await withMockFetch(async () => new Response('unavailable', { status: 503 }), async () => {
    await assert.rejects(runRust('', 'https://play.rust-lang.org/execute', new AbortController().signal), /HTTP 503/);
  });
});

async function transformFence(lang: string, meta: string, value: string) {
  const { default: plugin } = await import('../src/plugins/runnable.mjs');
  const tree = { children: [{ type: 'code', lang, meta, value }] };
  await plugin()(tree);
  return tree.children[0];
}

test('Rust, Go, TypeScript and ts fences become runnable when opted in', async () => {
  const cases = [
    { lang: 'rust', label: 'Rust', source: 'fn main() {}' },
    { lang: 'go', label: 'Go', source: 'package main' },
    { lang: 'typescript', label: 'TypeScript', source: 'console.log("ts")' },
    { lang: 'ts', label: 'TypeScript', source: 'console.log("alias")' },
  ];
  for (const { lang, label, source } of cases) {
    const block = await transformFence(lang, 'runnable', source);
    assert.equal(block.type, 'html', lang);
    assert.match(block.value, new RegExp(`data-language="${lang === 'ts' ? 'typescript' : lang}"`));
    assert.ok(block.value.includes(`aria-label="可运行 ${label} 代码"`));
    assert.ok(block.value.includes(`<span class="kotlin-label">${label}</span>`));
  }
});

test('unannotated non-Kotlin fences remain ordinary Markdown code blocks', async () => {
  for (const lang of ['rust', 'go', 'typescript', 'ts']) {
    const block = await transformFence(lang, '', 'example');
    assert.deepEqual(block, { type: 'code', lang, meta: '', value: 'example' });
  }
});

test('runnable source is escaped inside the generated HTML', async () => {
  const source = '</textarea><img src=x onerror="alert(1)"> &';
  const block = await transformFence('rust', 'runnable', source);
  assert.equal(block.type, 'html');
  assert.ok(block.value.includes('&lt;/textarea&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;'));
  assert.ok(!block.value.includes('</textarea><img'));
  assert.ok(!block.value.includes('<img src=x'));
});
