import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { runKotlin } from '../src/lib/kotlin.ts';

export function extractSnippets(markdown) {
  const tree = unified().use(remarkParse).parse(markdown);
  const blocks = [];
  function visit(node) {
    if (node.type === 'code' && node.lang === 'kotlin') {
      const flags = (node.meta || '').split(/\s+/);
      blocks.push({ source: node.value, mode: flags.includes('test') ? 'test' : flags.includes('file') ? 'file' : 'snippet', start: node.position.start.line, end: node.position.end.line });
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  return blocks;
}

export async function verify(file, line, execute = runKotlin) {
  const path = resolve(file);
  if (!/\.md$/i.test(path)) throw new Error('请打开并保存一个 .md 文件');
  const blocks = extractSnippets(await readFile(path, 'utf8'));
  const chosen = line === undefined ? blocks : blocks.filter(block => block.start <= line && line <= block.end);
  if (!chosen.length) throw new Error(line === undefined ? '当前文件没有 Kotlin 代码块' : '请把光标放到 Kotlin 代码块内部（或围栏所在行）');
  const runEndpoint = process.env.PUBLIC_KOTLIN_RUN_URL || 'https://api.kotlinlang.org/api/2.4.20/compiler/run';
  const testEndpoint = process.env.PUBLIC_KOTLIN_TEST_URL || runEndpoint.replace(/\/run\/?$/, '/test');
  let failures = 0;
  for (const block of chosen) {
    console.log(`\n${path}:${block.start}:1 — kotlin ${block.mode === 'snippet' ? '' : block.mode}`);
    try {
      const result = await execute(block.source, block.mode, block.mode === 'test' ? testEndpoint : runEndpoint, AbortSignal.timeout(30000));
      console.log(result.text);
      if (result.failed) {
        failures++;
        const diagnostic = result.text.match(/(?:ERROR|WARNING) File\.kt:(\d+)(?::\d+)? — ([^\n]+)/);
        const location = diagnostic ? Math.min(block.end, block.start + Number(diagnostic[1])) : block.start;
        console.log(`${path}:${location}:1: error: ${diagnostic?.[2] || 'Kotlin 执行或测试失败，详见上方输出'}`);
      } else console.log('✓ 通过');
    } catch (error) {
      failures++;
      console.log(`${path}:${block.start}:1: error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\n完成：${chosen.length - failures}/${chosen.length} 个代码块通过。`);
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (!(args.length === 1 || (args.length === 3 && args[1] === '--line'))) throw new Error('用法：npm run verify:snippets -- 文件.md [--line 行号]');
    const line = args.length === 3 ? Number(args[2]) : undefined;
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) throw new Error('行号必须是正整数');
    process.exitCode = await verify(args[0], line);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
