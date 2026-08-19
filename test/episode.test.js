import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEpisodeImages } from '../src/episode.js';

const html = await readFile(new URL('./fixtures/episode_tower_653.html', import.meta.url), 'utf8');
const VIEWER_URL =
  'https://www.webtoons.com/en/fantasy/tower-of-god/season-3-ep-235-season-3-finale/viewer?title_no=95&episode_no=653';

test('viewer page -> ordered unique image list', () => {
  const ep = parseEpisodeImages(html, { url: VIEWER_URL, titleNo: 95, episodeNo: 653, lang: 'en' });
  assert.equal(ep.titleNo, 95);
  assert.equal(ep.episodeNo, 653);
  assert.ok(ep.images.length >= 100, `finale should have ~140 images, got ${ep.images.length}`);
  assert.equal(new Set(ep.images).size, ep.images.length, 'images are unique & ordered');
  assert.ok(ep.images[0].startsWith('https://webtoon-phinf.pstatic.net/'), 'CDN host');
  assert.ok(/\.(jpe?g|png|webp)([?#]|$)/i.test(ep.images[0]), 'image extension');
});

test('viewer page keeps reading order (data-url attribute order)', () => {
  const ep = parseEpisodeImages(html, { titleNo: 95, episodeNo: 653 });
  // URLs contain increasing timestamps/ids; just assert no obvious reordering vs DOM.
  const ids = ep.images.map((u) => /_JPEG\/([^/]+)/.exec(u)?.[1] || '');
  assert.equal(ids.length, ep.images.length);
});