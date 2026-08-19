# webtoon-scraper

Scrape [webtoons.com](https://www.webtoons.com) from Node.js — search, chapter
lists, episode images, batch downloads and per-chapter **PDF export**.
Pure ESM, no browser, no headless Chromium. Built on `fetch` + `cheerio` + `pdf-lib`.

Verified end-to-end against live data (e.g. Tower of God — 652 episodes; a full
54-chapter series → 54 PDFs, page counts matched source images).

## Features

- **search** — keyword search, server-side rendered results
- **list** — full chapter list for a series (automatic pagination)
- **images** — all image URLs of an episode in reading order
- **download** — save episode images (resume-friendly, concurrency-limited)
- **pdf** — one PDF per chapter (or merge into a single file)
- Pure HTTP — no browser required; polite rate limiting + retries built in

## Install

```bash
# As a CLI
npm i -g github:findme-19/webtoon-scraper        # provides `webtoon`

# As a library in your project
npm i github:findme-19/webtoon-scraper
```

Requires Node >= 18 (uses global `fetch`).

## CLI

```bash
webtoon search "tower of god"

webtoon list "https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95" --latest 10

webtoon images "<viewer-url>"

webtoon pdf "<viewer-url>" -o chapter.pdf

# whole series, one PDF per chapter
webtoon pdf "https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95" \
  --episodes 645-653 --concurrency 6 -o downloads/ToG

# newest N then merge into a single file
webtoon pdf "<list-url>" --latest 3 --merge combined.pdf

# everything
webtoon pdf "<list-url>" --all -o downloads/Full
```

Options: `--lang en|id|...` (locale), `--concurrency N`, `--delay MS`
(extra politeness between image downloads), `--json`, `-o/--out`.

Batch mode is error-tolerant: a locked/broken chapter prints
`EP.NNN FAILED: ...` and the run continues (exit code 1 if any failed).

## Library API

```js
import * as Wt from 'webtoon-scraper';

// 1. search
const results = await Wt.searchSeries('tower of god');
// [{ titleNo, title, url, slug, thumb, lang }]

// 2. full chapter list (paginates automatically)
const series = await Wt.getChapterList(results[0].url);
// { titleNo, title, url, genre, slug, chapters: [{ episodeNo, title, url, thumb }] }

// 3. episode pages
const episode = await Wt.getEpisodeImages(series.chapters[0].url);
// { titleNo, episodeNo, title, url, images: [cdnUrl, ...] }  (reading order)

// 4. download images
await Wt.downloadImages(episode.images.slice(0, 5), './out/sample', { concurrency: 4 });

// 5. or straight to PDF
import { imagesToPdf } from 'webtoon-scraper';
await imagesToPdf(episode.images.slice(0, 5), 'sample.pdf', { title: episode.title });

// one shared, polite client
const client = new Wt.WebtoonClient({ lang: 'en', delayMs: 300 });
await Wt.getChapterList(results[0].url, { client });
await Wt.getEpisodeImages(epUrl, { client });
```

Also exported: `parseSearchResults`, `parseSeriesList`, `parseRss`,
`parseEpisodeImages`, `mergePdfs`, `WebtoonClient`, `HttpError`, `mapLimit`.

## Technical notes (verified)

- URLs use **`title_no=`** (underscore). `titleNo=` returns HTTP 500 "Connect
  Error :: WEBTOON".
- The `/list` page embeds only 10 episodes + a pagination footer. Walk
  `?page=N` incrementally; pages beyond the end return HTTP 200 with clamped
  duplicates, so the walker stops when a page adds zero new episode numbers.
- Image CDN (`webtoon-phinf.pstatic.net`) **requires** `Referer:
  https://www.webtoons.com/...` (403 otherwise).
- Episode images live in `<img class="_images" data-url="...">` — `data-url` is
  the real CDN URL, attribute order == reading order.
- A cookie jar is warmed from `GET /<lang>/` automatically.

## Tests

```
npm test
```

17 unit tests run against real fixture HTML captured from the live site, so
markup changes break the suite instead of silently producing garbage.

## Legal

For **personal archival / study use only**. You are responsible for complying
with webtoons.com terms and applicable copyright law. Do not redistribute
paywalled/locked content. Be polite: keep `--delay` sane.

## License

MIT — see LICENSE.