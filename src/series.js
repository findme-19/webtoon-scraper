/**
 * Series-level operations: chapter list for a title.
 *
 * Two independent sources are parsed:
 *  1. the series `list` page HTML (`.../list?title_no=N`)
 *  2. the public RSS feed (`.../rss?title_no=N`) — newest ~20 episodes
 * RSS is handy for lightweight polling; the HTML page lists the full catalog.
 */
import { WebtoonClient, isWebtoonClient } from './http.js';
import { load, extractTitleNo, extractEpisodeNo, extractSlug } from './parser.js';

/**
 * @typedef {object} Chapter
 * @property {number} episodeNo
 * @property {string} title
 * @property {string} url
 * @property {string} [date]
 * @property {string} [thumb]
 * @property {string} [lang]
 */

/**
 * @typedef {object} Series
 * @property {number} titleNo
 * @property {string} title
 * @property {string} url
 * @property {string} genre
 * @property {string} slug
 * @property {string} description
 * @property {string} thumb
 * @property {string} lang
 * @property {Chapter[]} chapters
 */

/**
 * Get chapter list for a series. The list page is server-side paginated
 * (10 chapters/page) — this walks every page via the `a.pg_next` link.
 *
 * @param {string|number|{titleNo:number}} target
 *   A series list URL, a viewer URL, or a bare title_no (uses a guessed path +
 *   the server's canonical redirect).
 * @param {object} [opts]
 * @param {WebtoonClient} [opts.client]
 * @param {string} [opts.lang='en']
 * @param {number} [opts.maxPages=0]  safety cap (0 = unlimited)
 * @returns {Promise<Series>}
 */
export async function getChapterList(target, { client, lang, maxPages = 0 } = {}) {
  const c = isWebtoonClient(client) ? client : new WebtoonClient({ lang: lang ?? 'en' });
  if (!c.warmed) await c.warmup();

  const titleNo = resolveTitleNo(target);
  if (!titleNo) throw new TypeError(`cannot resolve title_no from: ${String(target)}`);

  const listUrl = buildListUrl(target, c.lang, titleNo);
  if (!listUrl.startsWith('http')) throw new TypeError(`could not build a list URL from: ${String(target)}`);

  const byEpisode = new Map();
  let meta = null;

  // Pagination is a plain `page=N` counter. Pages past the end still return
  // HTTP 200 with duplicated content (the site clamps), so we stop as soon as
  // a page yields no NEW episodes.
  const [urlBase, urlQs] = listUrl.startsWith('http') ? listUrl.split('?') : [null, null];
  if (urlBase === null) throw new TypeError(`could not build a list URL from: ${String(target)}`);
  const q = new URLSearchParams(urlQs || '');
  const startPage = Number(q.get('page') || 1);
  q.delete('page');
  const cleanBase = `${urlBase}?${q.toString()}`.replace(/\?$/, '');
  const pageUrlOf = (n) => (n === startPage ? cleanBase : `${cleanBase}${cleanBase.includes('?') ? '&' : '?'}page=${n}`);

  for (let page = startPage; ; page++) {
    if (maxPages && page - startPage >= maxPages) break;
    const pageUrl = pageUrlOf(page);

    const res = await c.getRaw(pageUrl, {
      referer: c.baseUrl,
      accept: 'text/html,application/xhtml+xml,*/*',
    });
    const html = await res.text();
    if (html.length > c.maxBytes) throw new Error(`series page too big (${html.length}b)`);

    const parsed = parseSeriesList(html, c.lang, titleNo, res.url || pageUrl);
    if (!meta) meta = parsed;
    let added = 0;
    for (const ch of parsed.chapters) {
      if (!byEpisode.has(ch.episodeNo)) {
        byEpisode.set(ch.episodeNo, ch);
        added++;
      }
    }
    if (added === 0) break; // last real page (clamped duplicates) or empty
  }

  const chapters = [...byEpisode.values()].sort((a, b) => b.episodeNo - a.episodeNo);
  const result = meta ?? {
    titleNo,
    title: '',
    url: listUrl,
    genre: '',
    slug: '',
    description: '',
    thumb: '',
    lang: c.lang,
  };
  result.chapters = chapters;

  // RSS as a supplemental source when HTML parsing yielded nothing.
  if (chapters.length === 0) {
    try {
      const rssUrl = rssUrlFor(meta?.url || listUrl, titleNo, c.lang);
      const rssXml = await c.getText(rssUrl, { referer: c.baseUrl });
      result.chapters = parseRss(rssXml, c.lang);
    } catch {
      /* RSS is optional; ignore */
    }
  }
  return result;
}

/**
 * Parse a series list HTML page.
 * @param {string} html
 * @param {string} lang
 * @param {number} titleNo
 * @param {string} [pageUrl]  final (post-redirect) URL of the page
 */
export function parseSeriesList(html, lang, titleNo, pageUrl = '') {
  const $ = load(html);
  const chapters = [];
  const seenEp = new Set();

  $('a[href*="/viewer?"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const epNo = extractEpisodeNo(href);
    if (!epNo || seenEp.has(epNo)) return;

    let title = $a.find('.subj, [class*="title"], .episode-title').first().text().trim();
    if (!title) title = $a.text().replace(/\s+/g, ' ').trim().slice(0, 120);
    const thumb = $a.find('img[src]').first().attr('src') || '';
    const url = href.startsWith('http') ? href : `https://www.webtoons.com${href}`;
    seenEp.add(epNo);
    chapters.push({ episodeNo: epNo, title, url, thumb, lang });
  });

  // Fallback: rows keyed by episode ids / data attributes.
  if (chapters.length === 0) {
    $('[id^="episode_"], [data-episode-no]').each((_, el) => {
      const $el = $(el);
      const epNo = Number($el.attr('data-episode-no') || String($el.attr('id') || '').replace(/^episode_/, ''));
      if (!epNo || seenEp.has(epNo)) return;
      const a = $el.closest('a');
      const href = a.attr('href') || '';
      if (href && extractEpisodeNo(href)) {
        seenEp.add(epNo);
        chapters.push({
          episodeNo: epNo,
          title: $el.find('.sub-title, [class*="title"]').first().text().trim(),
          url: href.startsWith('http') ? href : `https://www.webtoons.com${href}`,
          thumb: '',
          lang,
        });
      }
    });
  }

  chapters.sort((a, b) => b.episodeNo - a.episodeNo);

  // cheerio decodes entities only in DOM text; meta attributes come raw
  // ("Bleach Can&rsquo;t..." -> "Bleach Can't...").
  const rawTitle =
    $('meta[property="og:title"]').attr('content')?.trim() || $('h1').first().text().trim() || '';
  const title = rawTitle ? $('<div>').html(rawTitle).text().trim() : '';
  const description = $('meta[property="og:description"]').attr('content') || '';
  const thumb = $('meta[property="og:image"]').attr('content') || '';
  const slug = extractSlug(pageUrl) || '';

  // Pagination: usually `<a class="pg_next" href="...&page=N">`.
  const nextHref = $('a.pg_next[href]').first().attr('href') || '';
  const nextUrl = nextHref.startsWith('http') ? nextHref : `https://www.webtoons.com${nextHref}`;

  return {
    titleNo,
    title,
    url: pageUrl,
    genre: genreFromPageUrl(pageUrl),
    slug,
    description,
    thumb,
    lang,
    chapters,
    nextUrl: nextUrl.startsWith('https://www.webtoons.com') ? nextUrl : '',
  };
}

/**
 * Parse the RSS feed XML into chapters (newest first).
 * @param {string} xml
 * @param {string} lang
 * @returns {import('./series.js').Chapter[]}
 */
export function parseRss(xml, lang = 'en') {
  const $ = load(xml, { xmlMode: true });
  const chapters = [];
  $('item').each((_, el) => {
    const $it = $(el);
    const link = $it.find('link').first().text().trim() || $it.find('guid').first().text().trim();
    const epNo = extractEpisodeNo(link);
    if (!epNo) return;
    chapters.push({
      episodeNo: epNo,
      title: ($it.find('title').first().text() || '').trim(),
      url: link,
      date: $it.find('pubDate').first().text().trim(),
      lang,
    });
  });
  chapters.sort((a, b) => b.episodeNo - a.episodeNo);
  return chapters;
}

/* ---------- private helpers ---------- */

function resolveTitleNo(target) {
  if (typeof target === 'number') return target;
  if (typeof target === 'string') return extractTitleNo(target);
  if (target && typeof target === 'object' && 'titleNo' in target) return Number(target.titleNo);
  return null;
}

/** Turn list/viewer/plain webtoons URL into its list-page URL; bare numbers get a guessed path. */
function buildListUrl(target, lang, titleNo) {
  if (typeof target === 'string' && target.startsWith('http')) {
    if (target.includes('/viewer?')) return viewerToList(target);
    return target;
  }
  // Guessed path — webtoons 301s to the canonical one.
  return `https://www.webtoons.com/${lang}/fantasy/series/list?title_no=${titleNo}`;
}

/** viewer URL -> list URL, keeping title_no, dropping episode_no. */
function viewerToList(url) {
  const [base, qs] = url.split('?');
  const params = new URLSearchParams(qs);
  params.delete('episode_no');
  return `${base.replace(/\/viewer$/, '/list')}?${params.toString()}`;
}

function rssUrlFor(pageUrl, titleNo, lang) {
  const canonical = pageUrl && pageUrl.includes('/list?title_no=') ? pageUrl : '';
  if (canonical) return canonical.replace(/\/list\?title_no=\d+/, `/rss?title_no=${titleNo}`);
  return `https://www.webtoons.com/${lang}/fantasy/series/rss?title_no=${titleNo}`;
}

function genreFromPageUrl(url) {
  const m = String(url).match(/webtoons\.com\/[a-z]{2}\/([^/]+)\//);
  return m ? m[1] : '';
}

export default getChapterList;