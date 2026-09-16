import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilerSource, formatResult, runKotlin } from '../src/lib/kotlin.ts';

test('snippet wraps exactly one function body, full file remains untouched', () => {
  assert.equal(compilerSource('println(1)', 'snippet'), 'fun main() {\nprintln(1)\n}');
  const file = 'import kotlin.math.sqrt\nfun main() { println(sqrt(4.0)) }';
  assert.equal(compilerSource(file, 'file'), file);
});
test('API stream markers removed while literal HTML remains text', () => {
  assert.deepEqual(formatResult({text:'<outStream><b>Hello</b> & world\n</outStream>'}, 'snippet'), {text:'<b>Hello</b> & world',failed:false});
});
test('compiler diagnostics use block-relative, one-based line numbers', () => {
  const response = {text:'',errors:{'File.kt':[{severity:'ERROR',message:'Missing',interval:{start:{line:1,ch:8}}}]}};
  assert.match(formatResult(response,'snippet').text,/File.kt:1:9/);
  assert.match(formatResult(response,'file').text,/File.kt:2:9/);
  assert.equal(formatResult(response,'snippet').failed,true);
});
test('runtime exception line offset and empty successful output', () => {
  const result = formatResult({text:'',exception:{fullName:'IllegalStateException',message:'oops',stackTrace:[{fileName:'File.kt',lineNumber:2,className:'FileKt',methodName:'main'}]}},'snippet');
  assert.match(result.text,/File.kt:1/); assert.equal(result.failed,true);
  assert.deepEqual(formatResult({text:''},'file'),{text:'（无输出）',failed:false});
});
test('HTTP failures are surfaced without treating them as program output', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('unavailable', {status:503});
    await assert.rejects(runKotlin('', 'snippet', 'https://example.com', new AbortController().signal), /HTTP 503/);
  } finally { globalThis.fetch = original; }
});


test('Kotlin highlight escapes HTML and colors Kotlin syntax', async () => {
  const { highlightKotlin } = await import('../src/lib/kotlin-highlight.mjs');
  const html = await highlightKotlin('val text = "<img src=x onerror=alert(1)>"');
  assert.ok(!html.includes('<img'));
  assert.match(html, /(?:&lt;|&#x3C;)img/);
  assert.ok(html.includes('#CC7832'));
  assert.ok(html.includes('#6A8759'));
});
test('Markdown test metadata selects a test panel without wrapping code', async () => {
  const { default: plugin } = await import('../src/plugins/runnable.mjs');
  const tree = { children: [{type:'code',lang:'kotlin',meta:'test',value:'class ExampleTest {}'}] };
  await plugin()(tree);
  assert.ok(tree.children[0].value.includes('data-mode="test"'));
  assert.ok(!tree.children[0].value.includes('fun main()'));
});


test('test files have no main wrapper and report mixed JUnit outcomes', () => {
  assert.equal(compilerSource('class ExampleTest {}','test'), 'class ExampleTest {}');
  const result = formatResult({testResults:{ExampleTest:[
    {className:'ExampleTest',methodName:'ok',status:'OK'},
    {className:'ExampleTest',methodName:'bad',status:'FAIL',comparisonFailure:{message:'expected:<3> but was:<2>'}},
  ]},errors:{}},'test');
  assert.equal(result.failed,true);
  assert.match(result.text,/通过 1 项/);
  assert.match(result.text,/expected:<3> but was:<2>/);
  assert.match(result.text,/\[失败\] ExampleTest.bad/);
  assert.equal(formatResult({testResults:{}},'test').failed,true);
});
test('JUnit request submits full test source and accepts response without text', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url,'https://example.com/compiler/test');
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.confType,'junit');
      assert.equal(payload.files[0].text,'class Test {}');
      return Response.json({testResults:{Test:[{className:'Test',methodName:'ok',status:'OK'}]},errors:{}});
    };
    const result = await runKotlin('class Test {}','test','https://example.com/compiler/test',new AbortController().signal);
    assert.equal(result.failed,false);
  } finally { globalThis.fetch = original; }
});
