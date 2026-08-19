import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSearchResults } from '../src/search.js';

const html = await readFile(new URL('./fixtures/search_tower.html', import.meta.url), 'utf8');

test('search results parse into series summaries', () => {
  const results = parseSearchResults(html, 'en');
  assert.ok(results.length >= 5, `expected >= 5 results, got ${results.length}`);
  const tog = results.find((r) => r.titleNo === 95);
  assert.ok(tog, 'Tower of God (titleNo 95) in results');
  assert.match(tog.url, /list\?title_no=95$/);
  assert.ok(tog.title.length > 0, 'has a title');
});

test('search results are deduped by titleNo', () => {
  const results = parseSearchResults(html, 'en');
  const ids = results.map((r) => r.titleNo);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate titleNo');
});