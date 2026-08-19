import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSeriesList, parseRss, getChapterList } from '../src/series.js';

const page1 = await readFile(new URL('./fixtures/series_tower_page1.html', import.meta.url), 'utf8');
const page2 = await readFile(new URL('./fixtures/series_tower_page2.html', import.meta.url), 'utf8');

test('series page 1: chapters parsed + pagination link', () => {
  const s = parseSeriesList(page1, 'en', 95, 'https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95');
  assert.equal(s.titleNo, 95);
  assert.ok(s.chapters.length >= 9, `page1 should carry ~10 chapters, got ${s.chapters.length}`);
  assert.ok(s.chapters[0].episodeNo >= s.chapters.at(-1).episodeNo, 'sorted newest first');
  assert.equal(s.chapters[0].episodeNo, 653, 'newest episode is 653');
  assert.match(s.chapters[0].url, /viewer\?title_no=95&episode_no=653$/);
  assert.ok(
    s.nextUrl.startsWith('https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95&page='),
    `nextUrl should be a list page url, got ${s.nextUrl}`,
  );
  assert.ok(s.title.includes('Tower of God'));
});

test('series page 2: episodes go older', () => {
  const s = parseSeriesList(page2, 'en', 95, 'https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95&page=2');
  assert.ok(s.chapters.length >= 8);
  assert.ok(s.chapters.every((c) => c.episodeNo <= 644), 'page 2 has older episodes');
});

test('rss parsing', () => {
  const rss = `<?xml version="1.0"?>
  <rss version="2.0"><channel>
    <item><title>Ep Beta</title><link>https://www.webtoons.com/en/fantasy/tower-of-god/x/viewer?title_no=95&amp;episode_no=654</link><pubDate>Tue, 01 Jan 2030 00:00:00 GMT</pubDate></item>
    <item><title>Ep Alpha</title><link>https://www.webtoons.com/en/fantasy/tower-of-god/y/viewer?title_no=95&amp;episode_no=653</link><pubDate>Mon, 31 Dec 2029 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const chapters = parseRss(rss, 'en');
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].episodeNo, 654);
  assert.equal(chapters[0].title, 'Ep Beta');
  assert.ok(chapters[0].date.startsWith('Tue'));
});

test('getChapterList walks pagination and stops on clamped duplicate page', async () => {
  const p1 = await readFile(new URL('./fixtures/series_tower_page1.html', import.meta.url), 'utf8');
  const p2 = await readFile(new URL('./fixtures/series_tower_page2.html', import.meta.url), 'utf8');
  const calls = [];
  const fakeClient = {
    warmed: true,
    lang: 'en',
    origin: 'https://www.webtoons.com',
    baseUrl: 'https://www.webtoons.com/en/',
    maxBytes: 25 * 1024 * 1024,
    async getRaw(url) {
      calls.push(url);
      const page = Number(new URL(url).searchParams.get('page') || 1);
      const html = page === 1 ? p1 : page === 2 ? p2 : p2; // beyond page 2 → clamped duplicate
      return { status: 200, url, text: async () => html };
    },
  };
  const series = await getChapterList('https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95', {
    client: fakeClient,
  });
  // page1 (645-653) ∪ page2 (up to 644) — deduped, newest first
  assert.ok(series.chapters.length > 15, `union of two pages, got ${series.chapters.length}`);
  assert.equal(series.chapters[0].episodeNo, 653);
  assert.equal(calls.length, 3, 'walked page1, page2, then page3 (clamped) before stopping');
});