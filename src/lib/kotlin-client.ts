import { runKotlin, type KotlinMode } from './kotlin';
const endpoint = import.meta.env.PUBLIC_KOTLIN_RUN_URL || 'https://api.kotlinlang.org/api/2.4.20/compiler/run';
const testEndpoint = import.meta.env.PUBLIC_KOTLIN_TEST_URL || endpoint.replace(/\/run\/?$/, '/test');
for (const block of document.querySelectorAll<HTMLElement>('.kotlin-example')) {
  const query = <T extends Element>(selector: string) => block.querySelector<T>(selector)!;
  const source = query<HTMLTextAreaElement>('.kotlin-source');
  const original = source.value;
  const preview = query<HTMLElement>('.kotlin-preview');
  const edit = query<HTMLButtonElement>('.kotlin-edit');
  const run = query<HTMLButtonElement>('.kotlin-run');
  const reset = query<HTMLButtonElement>('.kotlin-reset');
  const result = query<HTMLElement>('.kotlin-result');
  const status = query<HTMLElement>('.kotlin-status');
  const output = query<HTMLElement>('.kotlin-output');
  const mode = block.dataset.mode as KotlinMode;
  let editing = false;
  let highlightVersion = 0;
  const editor = query<HTMLElement>('.kotlin-editor');
  function syncScroll() {
    const pre = preview.querySelector('pre');
    if (pre) { pre.scrollTop = source.scrollTop; pre.scrollLeft = source.scrollLeft; }
  }
  async function repaint() {
    const version = ++highlightVersion;
    const text = source.value;
    try {
      const { highlightKotlin } = await import('./kotlin-highlight.mjs');
      const html = await highlightKotlin(text + (text.endsWith('\n') ? ' ' : ''));
      if (version !== highlightVersion) return;
      preview.innerHTML = html; syncScroll();
      editor.classList.remove('highlight-fallback');
    } catch {
      // Preserve editing even if the optional highlighter chunk fails to load.
      if (version === highlightVersion) {
        editor.classList.add('highlight-fallback');
        const pre = document.createElement('pre');
        const code = document.createElement('code'); code.textContent = text; pre.append(code); preview.replaceChildren(pre);
      }
    }
  }
  function setEditing(value: boolean) {
    editing = value; source.hidden = !value; preview.hidden = false;
    editor.classList.toggle('is-editing', value);
    edit.textContent = value ? '完成' : '编辑'; edit.setAttribute('aria-pressed', String(value));
    if (value) {
      editor.style.setProperty('--editor-height', `${Math.max(140, Math.min(600, source.value.split('\n').length * 25 + 44))}px`);
      source.focus();
    } else { source.scrollTop = 0; source.scrollLeft = 0; }
    if (source.value === original) { ++highlightVersion; preview.innerHTML = originalPreview; editor.classList.remove('highlight-fallback'); }
    else void repaint();
  }
  source.addEventListener('input', () => { void repaint(); });
  source.addEventListener('scroll', syncScroll);
  const originalPreview = preview.innerHTML;
  edit.addEventListener('click', () => setEditing(!editing));
  reset.addEventListener('click', () => { source.value = original; preview.innerHTML = originalPreview; setEditing(false); result.hidden = true; });
  query<HTMLButtonElement>('.kotlin-close').addEventListener('click', () => { result.hidden = true; });
  source.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run.click(); }
  });
  run.addEventListener('click', async () => {
    if (run.disabled) return;
    run.disabled = true; edit.disabled = true; reset.disabled = true; source.readOnly = true;
    run.textContent = '运行中…'; result.hidden = false; status.textContent = '正在编译和运行…'; output.textContent = ''; block.setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await runKotlin(source.value, mode, mode === 'test' ? testEndpoint : endpoint, controller.signal);
      output.textContent = response.text; status.textContent = response.failed ? '运行失败' : '运行完成';
    } catch (error) {
      status.textContent = '运行失败';
      output.textContent = controller.signal.aborted ? '请求超时，请稍后重试。' : error instanceof TypeError ? '无法连接 Kotlin 服务，请检查网络后重试。' : error instanceof Error ? error.message : '运行失败，请重试。';
    } finally {
      clearTimeout(timeout); run.disabled = false; edit.disabled = false; reset.disabled = false; source.readOnly = false; run.textContent = '▶ 运行'; block.removeAttribute('aria-busy');
    }
  });
}
