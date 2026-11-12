import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_EXPORT_EXTENSIONS, MAX_EXPORT_FILENAME_BYTES, resolveWebOrigin, navigationAction, parseExport } from '../lib/web-shell-policy.ts';
import { CODE_LANGUAGES } from '../../flownote/src/entities/blog/model/codeFiles.ts';

const origin = 'https://flownote-react.vercel.app';
test('only the two cloud web origins can be selected; no default production fallback', () => {
  assert.equal(resolveWebOrigin(origin), origin);
  assert.equal(resolveWebOrigin('https://flownote-react-staging.vercel.app'), 'https://flownote-react-staging.vercel.app');
  for (const value of [undefined, '', 'http://localhost:3000', `${origin}/canvas`, `${origin}.evil.test`, `https://user@flownote-react.vercel.app`]) {
    assert.throws(() => resolveWebOrigin(value));
  }
});
test('navigation pins the full origin and rejects credentials, native/file schemes and insecure links', () => {
  assert.equal(navigationAction(`${origin}/canvas/a`, origin), 'internal');
  assert.equal(navigationAction('https://example.com', origin), 'external');
  assert.equal(navigationAction('mailto:help@example.com', origin), 'external');
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'http://example.com', 'intent://x', 'https://user:pass@example.com', 'mailto:help@example.com\nBcc:evil@example.com']) {
    assert.equal(navigationAction(value, origin), 'block');
  }
});
test('the export bridge accepts bounded data only from the pinned web origin and sanitizes names', () => {
  const payload = { type: 'flownote.export', name: '../../노트.md', mime: 'text/markdown', base64: 'aGk=' };
  const parsed = parseExport(JSON.stringify(payload), `${origin}/blog/1`, origin);
  assert.equal(parsed.base64, 'aGk='); assert.equal(parsed.name, '노트.md');
  for (const source of ['https://evil.test', 'https://flownote-react-staging.vercel.app', 'file:///x']) {
    assert.throws(() => parseExport(JSON.stringify(payload), source, origin));
  }
  for (const patch of [{type:'open-url'}, {mime:'text/html'}, {mime:'toString'}, {mime:'constructor'}, {mime:'__proto__'}, {base64:'%%%%'}, {base64:'a'}, {base64:'a'.repeat(12_000_000)}, {url:'https://evil.test'}, {name:42}]) {
    assert.throws(() => parseExport(JSON.stringify({...payload,...patch}), origin, origin));
  }
  assert.equal(parseExport(JSON.stringify({...payload,name:'file.html'}), origin, origin).name, 'file.html.md');
});

test('code exports preserve every owned extension and exact UTF bytes without widening MIME trust', () => {
  const ownedExtensions = CODE_LANGUAGES.flatMap(language => language.extensions).sort();
  assert.deepEqual([...CODE_EXPORT_EXTENSIONS].sort(), ownedExtensions);
  const utf16le = Buffer.from([0xff, 0xfe, 0x70, 0x00, 0x72, 0x00, 0x69, 0x00, 0x6e, 0x00, 0x74, 0x00, 0x28, 0x00, 0x29, 0x00, 0x0d, 0x00, 0x0a, 0x00]);
  for (const extension of ownedExtensions) {
    const mime = extension === 'json' ? 'application/json' : 'text/plain';
    const payload = { type: 'flownote.export', name: `source.${extension}`, mime, base64: utf16le.toString('base64') };
    const parsed = parseExport(JSON.stringify(payload), `${origin}/blog/code`, origin);
    assert.equal(parsed.name, `source.${extension}`, extension);
    assert.equal(parsed.mime, mime, extension);
    assert.deepEqual(Buffer.from(parsed.base64, 'base64'), utf16le, extension);
  }
  const pythonAsJson = { type: 'flownote.export', name: 'source.py', mime: 'application/json', base64: 'e30=' };
  assert.equal(parseExport(JSON.stringify(pythonAsJson), origin, origin).name, 'source.py.json');
  const executableAsText = { type: 'flownote.export', name: '../../source.exe', mime: 'text/plain', base64: 'aGk=' };
  assert.equal(parseExport(JSON.stringify(executableAsText), origin, origin).name, 'source.exe.txt');
});

test('long safe code filenames keep their extension and fit the native cache component by UTF-8 bytes', () => {
  const bytes = Buffer.from('print("한글")\r\n', 'utf16le');
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]).toString('base64');
  const safeLongName = `${'module-'.repeat(14)}끝.py`;
  const safe = parseExport(JSON.stringify({ type: 'flownote.export', name: safeLongName, mime: 'text/plain', base64: utf16le }), origin, origin);
  assert.equal(safe.name, safeLongName);
  const oversizedName = `${'아주긴이름'.repeat(80)}.rs`;
  const truncated = parseExport(JSON.stringify({ type: 'flownote.export', name: oversizedName, mime: 'text/plain', base64: utf16le }), origin, origin);
  assert.match(truncated.name, /\.rs$/);
  assert(Buffer.byteLength(truncated.name, 'utf8') <= MAX_EXPORT_FILENAME_BYTES);
  assert(Buffer.byteLength(truncated.name, 'utf8') <= 255);
  assert(!truncated.name.includes('\ufffd'));
  const maxName = 'a'.repeat(252) + '.py';
  assert.equal(parseExport(JSON.stringify({ type: 'flownote.export', name: maxName, mime: 'text/plain', base64: utf16le }), origin, origin).name, maxName);
});
