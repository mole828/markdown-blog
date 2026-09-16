export interface ExecutionResult { text: string; failed: boolean }
export async function runRust(source: string, endpoint: string, signal: AbortSignal): Promise<ExecutionResult> {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', signal,
    body: JSON.stringify({ channel: 'stable', mode: 'debug', edition: '2021', crateType: 'bin', tests: false, code: source, backtrace: false }),
  });
  if (!response.ok) throw new Error(`运行服务返回 HTTP ${response.status}`);
  const result = await response.json();
  if (typeof result?.success !== 'boolean' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('运行服务返回了无法识别的结果');
  return { text: [result.stdout, result.stderr].filter(Boolean).join('\n') || '（无输出）', failed: !result.success };
}

// Execute in a worker inside an opaque-origin iframe. The worker can be terminated
// even for an infinite loop; CSP prevents network requests from edited examples.
export async function runTypeScript(source: string, signal: AbortSignal): Promise<ExecutionResult> {
  const ts = await import('typescript');
  if (signal.aborted) throw new Error('运行已取消');
  const compiled = ts.transpileModule(`(async () => {\n${source}\n})()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true,
  });
  const errors = compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) || [];
  if (errors.length) return { text: errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'), failed: true };
  const workerSource = `
    const send = self.postMessage.bind(self);
    const lines = [];
    const format = value => { try { return typeof value === 'string' ? value : value instanceof Error ? value.message : JSON.stringify(value) ?? String(value); } catch { return String(value); } };
    let size = 0;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = (...args) => {
      if (size > 100000) return;
      const line = args.map(format).join(' '); size += line.length; lines.push(line.slice(0, 100000));
    };
    self.addEventListener('unhandledrejection', event => { event.preventDefault(); send({ text: [...lines, format(event.reason)].join('\\n'), failed: true }); });
    Promise.resolve().then(() => ${compiled.outputText.trim().replace(/;$/, '')}).then(
      () => send({ text: lines.join('\\n') || '（无输出）', failed: false }),
      error => send({ text: [...lines, format(error)].join('\\n'), failed: true }));
  `;
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    const cleanup = () => { window.removeEventListener('message', receive); signal.removeEventListener('abort', abort); frame.remove(); };
    const abort = () => { cleanup(); reject(new Error('运行超时或已取消')); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || typeof event.data?.text !== 'string' || typeof event.data.failed !== 'boolean') return;
      cleanup(); resolve({ text: event.data.text, failed: event.data.failed });
    };
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    const embedded = JSON.stringify(workerSource).replaceAll('<', '\\u003c');
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:"><script>
      const url = URL.createObjectURL(new Blob([${embedded}], {type:'text/javascript'}));
      const worker = new Worker(url);
      worker.onmessage = event => { parent.postMessage(event.data, '*'); worker.terminate(); URL.revokeObjectURL(url); };
      worker.onerror = event => { parent.postMessage({text:event.message || '执行失败', failed:true}, '*'); worker.terminate(); URL.revokeObjectURL(url); };
    <\/script>`;
    document.body.append(frame);
    if (signal.aborted) abort();
  });
}
