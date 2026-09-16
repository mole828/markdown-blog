export type KotlinMode = 'snippet' | 'file' | 'test';
export function compilerSource(source: string, mode: KotlinMode): string {
  return mode !== 'snippet' ? source : `fun main() {\n${source}\n}`;
}
interface Diagnostic { severity?: string; message?: string; interval?: { start?: { line?: number; ch?: number } }; }
interface KotlinException { fullName?: string; message?: string; stackTrace?: { fileName?: string; lineNumber?: number; className?: string; methodName?: string }[]; }
interface TestResult { className?: string; methodName?: string; status?: string; output?: string; exception?: KotlinException | null; comparisonFailure?: (KotlinException & { expected?: string; actual?: string }) | null; }
export interface RunResponse { testResults?: Record<string, TestResult[]>; text?: string; errors?: Record<string, Diagnostic[]>; exception?: KotlinException | null; }
export function formatResult(result: RunResponse, mode: KotlinMode): { text: string; failed: boolean } {
  const offset = mode === 'snippet' ? 1 : 0;
  const sections: string[] = [];
  // The API wraps raw stdout/stderr in these tags; user output is NOT HTML-encoded.
  const output = (result.text || '').replace(/<\/?(?:outStream|errStream)>/g, '');
  if (output) sections.push(output.replace(/\n$/, ''));
  const diagnostics = Object.entries(result.errors || {}).flatMap(([file, errors]) => errors.map(error => {
    const start = error.interval?.start;
    const line = typeof start?.line === 'number' ? Math.max(1, start.line + 1 - (file === 'File.kt' ? offset : 0)) : undefined;
    const column = typeof start?.ch === 'number' ? start.ch + 1 : undefined;
    return `${error.severity || 'ERROR'} ${file}${line ? `:${line}${column ? `:${column}` : ''}` : ''} — ${error.message || '编译失败'}`;
  }));
  sections.push(...diagnostics);
  if (result.exception) {
    sections.push(`${result.exception.fullName || '运行异常'}: ${result.exception.message || ''}`);
    for (const frame of result.exception.stackTrace || []) {
      if (frame.fileName === 'File.kt' && frame.lineNumber && frame.lineNumber > 0) {
        sections.push(`  at ${frame.className}.${frame.methodName} (File.kt:${Math.max(1, frame.lineNumber - offset)})`);
      }
    }
  }
  const testCases = Object.values(result.testResults || {}).flat();
  if (mode === 'test') {
    if (!testCases.length && !diagnostics.length && !result.exception) sections.push('未发现测试，请定义包含 @Test 方法的测试类。');
    for (const entry of testCases) {
      const label = entry.status === 'OK' ? '通过' : entry.status === 'FAIL' ? '失败' : entry.status || '未知';
      sections.push(`[${label}] ${entry.className || ''}.${entry.methodName || ''}`);
      if (entry.output) sections.push(entry.output.replace(/<\/?(?:outStream|errStream)>/g, ''));
      const failure = entry.comparisonFailure || entry.exception;
      if (failure) sections.push(`${failure.fullName || '断言失败'}: ${failure.message || ''}`);
    }
    if (testCases.length) sections.push(`共 ${testCases.length} 项，通过 ${testCases.filter(entry => entry.status === 'OK').length} 项，未通过 ${testCases.filter(entry => entry.status !== 'OK').length} 项。`);
  }
  const failed = (mode === 'test' && (!testCases.length || testCases.some(entry => entry.status !== 'OK'))) || Boolean(result.exception) || Object.values(result.errors || {}).flat().some(error => (error.severity || 'ERROR').toUpperCase() === 'ERROR');
  return { text: sections.join('\n') || '（无输出）', failed };
}
export async function runKotlin(source: string, mode: KotlinMode, endpoint: string, signal: AbortSignal) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', signal,
    body: JSON.stringify({ args: '', files: [{ name: 'File.kt', text: compilerSource(source, mode), publicId: '' }], confType: mode === 'test' ? 'junit' : 'java' }),
  });
  if (!response.ok) throw new Error(`运行服务返回 HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || (mode === 'test' ? !('testResults' in result || 'errors' in result || 'exception' in result) : !('text' in result) || typeof result.text !== 'string')) throw new Error('运行服务返回了无法识别的结果');
  return formatResult(result as RunResponse, mode);
}
