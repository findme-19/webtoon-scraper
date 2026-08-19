import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTitleNo, extractEpisodeNo, extractSlug, uniq } from '../src/parser.js';

test('extractTitleNo from list url', () => {
  assert.equal(extractTitleNo('https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95'), 95);
});

test('extractTitleNo from viewer url', () => {
  assert.equal(
    extractTitleNo('https://www.webtoons.com/en/fantasy/tower-of-god/season-3-ep-235-season-3-finale/viewer?title_no=95&episode_no=653'),
    95,
  );
});

test('extractTitleNo supports legacy camelCase param', () => {
  assert.equal(extractTitleNo('https://www.webtoons.com/en/fantasy/x/list?titleNo=81'), 81);
});

test('extractEpisodeNo', () => {
  assert.equal(extractEpisodeNo('.../viewer?title_no=95&episode_no=653'), 653);
  assert.equal(extractEpisodeNo('.../viewer?title_no=95'), null);
});

test('extractSlug', () => {
  assert.equal(extractSlug('https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95'), 'tower-of-god');
});

test('uniq preserves order and removes duplicates', () => {
  assert.deepEqual(uniq([3, 1, 3, 2, 1]), [3, 1, 2]);
});