#!/usr/bin/env node
/**
 * Webtoon scraper CLI.
 *
 *   webtoon search <keyword> [--lang en] [--limit 10]
 *   webtoon list <seriesUrl|titleNo> [--lang en] [--json]
 *   webtoon images <viewerUrl> [--lang en] [--json]
 *   webtoon download <viewerUrl|seriesUrl> [-o DIR] [--episodes 640-653|--latest N|--all]
 *   webtoon pdf <viewerUrl|seriesUrl> [-o FILE] [--episodes 5,7|--latest N|--all] [--merge FILE]
 *
 * Options: --concurrency N (default 4), --delay MS (default 300), --lang xx (default en).
 * `pdf` with a viewer URL makes one PDF. `pdf` with a series URL makes one PDF
 * per episode (ordered); append --merge out.pdf to combine them.
 */
import { WebtoonClient } from './http.js';
import { searchSeries } from './search.js';
import { getChapterList } from './series.js';
import { getEpisodeImages } from './episode.js';
import { downloadImages } from './downloader.js';
import { imagesToPdf } from './pdf.js';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--json') out.json = true;
    else if (a === '--all') out.all = true;
    else if (a === '--merge') out.merge = argv[++i] ?? true; // value = output file, bare flag = default
    else if (a === '--lang') out.lang = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--latest') out.latest = Number(argv[++i]);
    else if (a === '--episodes') out.episodes = argv[++i];
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--delay') out.delay = Number(argv[++i]);
    else if (a === '-o' || a === '--out') out.out = argv[++i];
    else if (a.startsWith('-')) fail(`unknown option: ${a}`);
    else out._.push(a);
  }
  return out;
}

/* Parse "5,7,640-653" into a sorted Set of episode numbers. */
function parseEpisodeSel(spec) {
  const set = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const lo = Math.min(+m[1], +m[2]);
      const hi = Math.max(+m[1], +m[2]);
      for (let n = lo; n <= hi; n++) set.add(n);
    } else if (/^\d+$/.test(part)) set.add(+part);
  }
  return set;
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function isViewerUrl(s) {
  return typeof s === 'string' && s.includes('/viewer?');
}

async function cmdSearch(opts) {
  const q = opts._[0];
  if (!q) fail('search needs a keyword');
  const results = await searchSeries(q, { lang: opts.lang });
  const list = opts.limit ? results.slice(0, opts.limit) : results;
  if (opts.json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  if (list.length === 0) {
    console.log(`no results for "${q}"`);
    return;
  }
  console.log(`search "${q}" → ${list.length} result(s)\n`);
  for (const r of list) {
    console.log(`  [${r.titleNo}] ${r.title}\n        ${r.url}`);
  }
}

async function cmdList(opts) {
  const target = opts._[0];
  if (!target) fail('list needs a series URL or titleNo');
  const client = new WebtoonClient({ lang: opts.lang });
  const series = await getChapterList(target, { client, lang: opts.lang });
  if (opts.json) {
    console.log(JSON.stringify(series, null, 2));
    return;
  }
  console.log(`${series.title} (title_no=${series.titleNo}, ${series.chapters.length} chapters)`);
  const shown =
    opts.latest ? series.chapters.slice(0, opts.latest)
    : opts.limit ? series.chapters.slice(0, opts.limit)
    : series.chapters;
  for (const ch of shown) {
    console.log(`  #${ch.episodeNo} ${ch.title}${ch.date ? `  (${ch.date.slice(0, 10)})` : ''}`);
  }
  if (shown.length < series.chapters.length) {
    console.log(`  … ${series.chapters.length - shown.length} more (use --json for the full list)`);
  }
}

async function cmdImages(opts) {
  const url = opts._[0];
  if (!isViewerUrl(url)) fail('images needs a viewer URL (…/viewer?title_no=N&episode_no=M)');
  const client = new WebtoonClient({ lang: opts.lang });
  const ep = await getEpisodeImages(url, { client, lang: opts.lang });
  if (opts.json) {
    console.log(JSON.stringify(ep, null, 2));
    return;
  }
  console.log(`${ep.title} — ${ep.images.length} images`);
  ep.images.forEach((u, i) => console.log(`  ${String(i + 1).padStart(3)} ${u}`));
}

/* Resolve a series target into a chapter list, or a single viewer into one chapter. */
async function resolveEpisodes(opts, client) {
  const target = opts._[0];
  if (!target) fail('missing target (viewer URL or series URL/titleNo)');
  if (isViewerUrl(target)) {
    const ep = await getEpisodeImages(target, { client, lang: opts.lang });
    return {
      series: {
        titleNo: ep.titleNo,
        // "Tower of God - [Season 3] Ep. 12" -> "Tower of God"
        title: ep.title.split(' - ')[0].replace(/\[Season[^\]]*\]\s*/g, '').trim() || `title_${ep.titleNo}`,
      },
      episodes: [{ episodeNo: ep.episodeNo, title: ep.title, url: target, images: ep.images }],
      direct: true,
    };
  }
  const series = await getChapterList(target, { client, lang: opts.lang });
  let list = series.chapters;
  if (opts.episodes) {
    const sel = parseEpisodeSel(opts.episodes);
    list = list.filter((c) => sel.has(c.episodeNo));
  } else if (opts.latest) {
    list = list.slice(0, opts.latest);
  } else if (!opts.all) {
    throw `specify --episodes, --latest N or --all for a series target (series has ${series.chapters.length} chapters)`;
  }
  if (list.length === 0) throw 'no chapters matched the selection';
  return { series, episodes: list, direct: false };
}

/**
 * `merge` — combine already-built chapter PDFs in a directory into one file.
 * No downloading, no rebuild: reads every *.pdf in `dir` (numeric sort),
 * concatenates and writes `out`.
 *   webtoon merge <dir> out.pdf
 *   webtoon merge <dir> -o out.pdf
 */
async function cmdMerge(opts) {
  const dir = opts._[0];
  const out =
    opts._[1] ||
    (opts.out && String(opts.out).toLowerCase().endsWith('.pdf') ? opts.out : '');
  if (!dir || !out) fail('usage: webtoon merge <dir-containing-chapter-pdfs> <out.pdf>');
  const files = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!name.toLowerCase().endsWith('.pdf')) continue;
    const abs = join(dir, name);
    try {
      if ((await stat(abs)).isFile()) files.push(abs);
    } catch {
      /* ignore */
    }
  }
  if (files.length === 0) fail(`no PDF files found in ${dir}`);
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  await mkdir(dirname(out), { recursive: true });
  const { mergePdfs } = await import('./pdf.js');
  const res = await mergePdfs(files, out);
  console.log(
    `merged ${files.length} PDFs → ${res.path} (${res.pages} pages, ${(res.bytes / 1024 / 1024).toFixed(2)} MB)`,
  );
}

async function cmdDownload(opts) {
  const client = new WebtoonClient({ lang: opts.lang });
  const { series, episodes, direct } = await resolveEpisodes(opts, client);
  for (const ep of episodes) {
    const epInfo = direct ? ep : await getEpisodeImages(ep.url, { client, lang: opts.lang });
    const base = opts.out || `downloads/${sanitize(series.title || series.titleNo)}`;
    const dir = `${base}/EP_${String(epInfo.episodeNo).padStart(3, '0')}`;
    console.log(`downloading EP.${epInfo.episodeNo} (${epInfo.images.length} images) → ${dir}`);
    await downloadImages(epInfo.images, dir, {
      client,
      concurrency: opts.concurrency,
      delay: opts.delay,
      onProgress: (done, total) => {
        if (done % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
      },
    });
    process.stdout.write('\n');
  }
}

async function cmdPdf(opts) {
  const client = new WebtoonClient({ lang: opts.lang });
  const { series, episodes, direct } = await resolveEpisodes(opts, client);
  const slug = sanitize(series.title || String(series.titleNo));
  const outDir = opts.out && !String(opts.out).toLowerCase().endsWith('.pdf') ? opts.out : null;
  const files = [];
  let ok = 0;
  let failed = 0;
  for (const ep of episodes) {
    try {
      const epInfo = ep.images ? ep : await getEpisodeImages(ep.url, { client, lang: opts.lang });
      if (epInfo.images.length === 0) throw new Error('no images on viewer page (locked or broken)');
      const cacheDir = `${outDir || `downloads/${slug}`}/EP_${String(epInfo.episodeNo).padStart(3, '0')}`;
      console.log(`EP.${epInfo.episodeNo} — ${epInfo.images.length} images`);
      const paths = await downloadImages(epInfo.images, cacheDir, {
        client,
        concurrency: opts.concurrency,
        delay: opts.delay,
      });
      const pdfOut =
        opts.out && String(opts.out).toLowerCase().endsWith('.pdf') && !opts.merge
          ? opts.out
          : `${cacheDir}.pdf`;
      const res = await imagesToPdf(paths, pdfOut, {
        title: `${series.title} EP.${epInfo.episodeNo} — ${epInfo.title}`,
        onProgress: (done, total) => {
          if (done % 25 === 0 || done === total) process.stdout.write(`\r  pdf ${done}/${total}`);
        },
      });
      process.stdout.write('\n');
      console.log(`  saved ${res.path} (${res.pages} pages, ${(res.bytes / 1024 / 1024).toFixed(2)} MB)`);
      files.push(res.path);
      ok++;
    } catch (err) {
      console.error(`  EP.${ep.episodeNo} FAILED: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }
  console.log(`\nbatch done: ${ok}/${episodes.length} PDFs saved` + (failed ? `, ${failed} failed` : ''));
  if (opts.merge && files.length > 1) {
    // Precedence: explicit --merge path  >  -o out.pdf  >  default under downloads/
    const merged =
      (typeof opts.merge === 'string' && opts.merge) ||
      (opts.out && String(opts.out).toLowerCase().endsWith('.pdf') && !opts.merge ? opts.out : '') ||
      `downloads/${slug}/merged.pdf`;
    await mkdir(dirname(merged), { recursive: true });
    const { mergePdfs } = await import('./pdf.js');
    const res = await mergePdfs(files, merged, { title: series.title });
    console.log(`merged ${files.length} PDFs → ${res.path} (${(res.bytes / 1024 / 1024).toFixed(2)} MB)`);
  }
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts._.length === 0) {
    console.log(USAGE_TEXT);
    process.exit(0);
  }
  const [command, ...cmdArgs] = opts._;
  opts._ = cmdArgs;
  try {
    if (command === 'search') return await cmdSearch(opts);
    if (command === 'list') return await cmdList(opts);
    if (command === 'images') return await cmdImages(opts);
    if (command === 'download') return await cmdDownload(opts);
    if (command === 'pdf') return await cmdPdf(opts);
    if (command === 'merge') return await cmdMerge(opts);
    fail(`unknown command: ${command}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

const USAGE_TEXT = `
webtoon-scraper — search, list, download & PDF from webtoons.com

USAGE
  webtoon search <keyword> [--lang en] [--limit 10]
  webtoon list <series-url|titleNo> [--lang en]
  webtoon images <viewer-url>
  webtoon download <series-url> --episodes 5,9-12|--latest 3|--all [-o DIR]
  webtoon pdf <viewer-url|-o out.pdf>   (one chapter → one PDF)
  webtoon pdf <series-url> --episodes 5,9-12|--latest 3|--all [--merge out.pdf]
  webtoon merge <dir-with-chapter-pdfs> out.pdf   (merge already-built PDFs only)

OPTIONS
  --lang xx          webtoons locale (en|id|zh|ja|ko), default en
  --episodes X,Y-Z   chapter selection
  --latest N         newest N chapters
  --all              all chapters
  --concurrency N    image download workers (default 4)
  --delay N          ms of extra politeness between image downloads (default 120)
  --json             output raw JSON
  --merge out.pdf    combine chapter PDFs into one file
  -h, --help
`.trim();

main();