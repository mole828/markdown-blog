import { highlightKotlin } from '../lib/kotlin-highlight.mjs';
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export default function runnable() {
  return async (tree) => {
    const jobs = [];
    function walk(node) {
      if (node.type === 'code' && node.lang === 'kotlin') {
        jobs.push((async () => {
          const flags = (node.meta || '').split(/\s+/);
          const mode = flags.includes('test') ? 'test' : flags.includes('file') ? 'file' : 'snippet';
          const source = node.value;
          const highlighted = await highlightKotlin(source);
          node.type = 'html';
          node.value = `<section class="kotlin-example" data-mode="${mode}" aria-label="可运行 Kotlin 代码"><div class="kotlin-toolbar"><span class="kotlin-label">${mode === 'test' ? 'Kotlin · Test' : mode === 'file' ? 'Kotlin · File.kt' : 'Kotlin'}</span><div class="kotlin-actions"><button type="button" class="kotlin-edit" aria-pressed="false">编辑</button><button type="button" class="kotlin-reset">重置</button><button type="button" class="kotlin-run" title="发送到 Kotlin 官方服务运行">▶ 运行</button></div></div><div class="kotlin-editor"><div class="kotlin-preview">${highlighted}</div><textarea class="kotlin-source" aria-label="Kotlin 代码" spellcheck="false" autocapitalize="off" autocomplete="off" hidden>${escape(source)}</textarea></div><div class="kotlin-result" hidden><div class="kotlin-result-bar"><span class="kotlin-status" role="status"></span><button type="button" class="kotlin-close" aria-label="关闭运行结果">×</button></div><pre class="kotlin-output" tabindex="0"></pre></div></section>`;
        })());
      } else node.children?.forEach(walk);
    }
    walk(tree);
    await Promise.all(jobs);
  };
}
