import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imagesToPdf, mergePdfs, detectImageType } from '../src/pdf.js';

// 1x1 transparent PNG
const PNG1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pngBuf = Buffer.from(PNG1, 'base64');

test('detectImageType', () => {
  assert.equal(detectImageType(pngBuf), 'png');
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])), 'jpg');
});

test('imagesToPdf writes a valid PDF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-pdf-'));
  try {
    const out = join(dir, 'test.pdf');
    const res = await imagesToPdf([pngBuf, pngBuf], out, { title: 'Test' });
    assert.equal(res.pages, 2);
    const data = await readFile(out);
    assert.ok(data.subarray(0, 5).toString() === '%PDF-', 'PDF magic bytes');
    assert.equal(data.length, res.bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergePdfs combines files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-merge-'));
  try {
    const a = join(dir, 'a.pdf');
    const b = join(dir, 'b.pdf');
    await imagesToPdf([pngBuf], a);
    await imagesToPdf([pngBuf, pngBuf], b);
    const merged = join(dir, 'm.pdf');
    const res = await mergePdfs([a, b], merged);
    assert.equal(res.pages, 3);
    const data = await readFile(merged);
    assert.ok(data.subarray(0, 5).toString() === '%PDF-');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});