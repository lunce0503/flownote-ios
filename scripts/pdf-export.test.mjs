import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPdfExportReceiver, PDF_CHUNK_BYTES, MAX_PDF_EXPORT_BYTES } from '../lib/pdf-export-protocol.ts';

const origin = 'https://flownote-react-staging.vercel.app';
const id = '11111111-1111-4111-8111-111111111111';
const fixture = () => {
  const events = [], parts = [];
  let deleted = 0, closed = false, shared = 0;
  const receiver = createPdfExportReceiver({
    confirm: async () => true,
    open: () => ({ append: bytes => parts.push(Buffer.from(bytes)), close: () => { closed = true; }, remove: () => { deleted++; }, uri: 'private-cache/book.pdf' }),
    share: async () => { assert(closed); shared++; },
    notify: event => events.push(event),
  });
  const send = data => receiver.receive(JSON.stringify(data), origin + '/library', origin);
  return { receiver, send, events, parts, get deleted() { return deleted; }, get shared() { return shared; } };
};
test('PDF receiver streams the 100MiB boundary with one bounded chunk and exact bytes', async () => {
  const f = fixture(), hash = createHash('sha256');
  await f.send({ type: 'flownote.pdf-export.start', id, name: '../original.pdf', bytes: MAX_PDF_EXPORT_BYTES });
  const block = Buffer.alloc(PDF_CHUNK_BYTES, 42); block.write('%PDF-1.7');
  for (let index = 0; index < MAX_PDF_EXPORT_BYTES / PDF_CHUNK_BYTES; index++) {
    hash.update(block);
    await f.send({ type: 'flownote.pdf-export.chunk', id, index, base64: block.toString('base64') });
  }
  await f.send({ type: 'flownote.pdf-export.finish', id });
  assert.equal(f.shared, 1); assert.equal(f.deleted, 1);
  assert.equal(createHash('sha256').update(Buffer.concat(f.parts)).digest('hex'), hash.digest('hex'));
  assert.equal(f.events.at(-1).state, 'complete'); assert.equal(f.receiver.busy, false);
});
test('PDF origin, exact schema, kind, size, sequence and header fail closed and remove partial files', async () => {
  const f = fixture();
  await assert.rejects(f.receiver.receive(JSON.stringify({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9 }), 'https://evil.example/library', origin));
  for (const patch of [{ bytes: MAX_PDF_EXPORT_BYTES + 1 }, { name: 'bad.exe' }, { extra: true }]) {
    await assert.rejects(f.send({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9, ...patch }));
  }
  await f.send({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9 });
  await assert.rejects(f.send({ type: 'flownote.pdf-export.chunk', id, index: 1, base64: Buffer.from('%PDF-test').toString('base64') }));
  assert.equal(f.deleted, 1); assert.equal(f.shared, 0);
  const g = fixture();
  await g.send({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9 });
  await assert.rejects(g.send({ type: 'flownote.pdf-export.chunk', id, index: 0, base64: Buffer.from('not a pdf').toString('base64') }));
  assert.equal(g.deleted, 1); assert.equal(g.shared, 0);
});
test('PDF cancellation and incomplete finish retain no partial export and never share it', async () => {
  const f = fixture();
  await f.send({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9 });
  await assert.rejects(f.send({ type: 'flownote.pdf-export.finish', id }));
  assert.equal(f.shared, 0); assert.equal(f.deleted, 1);
  await f.send({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9 });
  f.receiver.cancel(); assert.equal(f.receiver.busy, false); assert.equal(f.deleted, 2);
});
test('navigation during confirmation cannot create a late export; sharing remains single-flight', async () => {
  let approve, opened = 0;
  const receiver = createPdfExportReceiver({ confirm: () => new Promise(resolve => { approve = resolve; }),
    open: () => { opened++; throw new Error('Must not open after navigation'); }, share: async () => {}, notify: () => {} });
  const pending = receiver.receive(JSON.stringify({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9 }), origin, origin);
  receiver.cancel(); approve(true); await pending;
  assert.equal(opened, 0); assert.equal(receiver.busy, false);
  let finishSharing, deleted = false;
  const sharing = createPdfExportReceiver({ confirm: async () => true,
    open: () => ({ uri: 'cache.pdf', append: () => {}, close: () => {}, remove: () => { deleted = true; } }),
    share: () => new Promise(resolve => { finishSharing = resolve; }), notify: () => {} });
  const send = data => sharing.receive(JSON.stringify(data), origin, origin);
  await send({ type: 'flownote.pdf-export.start', id, name: 'a.pdf', bytes: 9 });
  await send({ type: 'flownote.pdf-export.chunk', id, index: 0, base64: Buffer.from('%PDF-test').toString('base64') });
  const finishing = send({ type: 'flownote.pdf-export.finish', id });
  sharing.cancel(); assert.equal(deleted, false); assert.equal(sharing.busy, true);
  finishSharing(); await finishing; assert.equal(deleted, true); assert.equal(sharing.busy, false);
});
