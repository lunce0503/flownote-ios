import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteContentToPlainText, isPlainTextNoteContent } from './note-content.ts';
test('native clients show Markdown source and preserve rich content on title-only saves', () => {
 const doc={format:'markdown',version:1,markdown:'# 한글\n\n$x^2$\n',legacy_original:[{type:'drawing'}]};
 assert.equal(noteContentToPlainText(doc),doc.markdown);
 assert.equal(isPlainTextNoteContent(doc),false);
 assert.deepEqual(doc.legacy_original,[{type:'drawing'}]);
});
