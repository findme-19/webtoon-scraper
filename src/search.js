/**
 * Search webtoons.com and return matching series.
 *
 * The search page renders results server-side: every result card carries a
 * `data-title-no` attribute plus an anchor linking to the series list page.
 */
import { WebtoonClient, isWebtoonClient } from './http.js';
import { load, extractSlug } from './parser.js';

/**
 * @typedef {object} SeriesSummary
 * @property {number} titleNo
 * @property {string} title
 * @property {string} url
 * @property {string} [genre]
 * @property {string} [slug]
 * @property {string} [thumb]
 * @property {string} [lang]
 */

/**
 * Search webtoons.com.
 * @param {string} keyword
 * @param {object} [opts]
 * @param {WebtoonClient} [opts.client]  existing client (reuses cookies/rate limit)
 * @param {string} [opts.lang='en']
 * @returns {Promise<SeriesSummary[]>}
 */
export async function searchSeries(keyword, { client, lang } = {}) {
  const c = isWebtoonClient(client) ? client : new WebtoonClient({ lang: lang ?? 'en' });
  if (!c.warmed) await c.warmup();
  const url = `${c.origin}/${c.lang}/search?keyword=${encodeURIComponent(keyword)}`;
  const html = await c.getText(url, { referer: c.baseUrl });
  return parseSearchResults(html, c.lang);
}

/**
 * Parse the search results page into structured series summaries.
 * @param {string} html
 * @param {string} lang
 * @returns {import('./search.js').SeriesSummary[]}
 */
export function parseSearchResults(html, lang = 'en') {
  const $ = load(html);
  /** @type {import('./search.js').SeriesSummary[]} */
  const out = [];
  const seen = new Set();
  $('[data-title-no]').each((_, el) => {
    const $el = $(el);
    const titleNo = Number($el.attr('data-title-no'));
    if (!titleNo || seen.has(titleNo)) return;
    seen.add(titleNo);

    const href = $el.attr('href') || $el.find('a[href]').first().attr('href') || '';
    const anchor = $el.closest('a');
    let title = ($el.attr('title') || $el.attr('alt') || '').trim();
    if (!title) title = anchor.find('.title, .subj, [class*="title"]').first().text().trim();
    if (!title) title = (anchor.attr('title') || '').trim();
    // Last resort: raw anchor text, cleaned of view counts / author noise.
    if (!title) {
      title = anchor
        .text()
        .replace(/\b\d[KMB]? Views?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    }
    const thumb =
      $el.find('img[src]').first().attr('src') ||
      $el.closest('a').find('img[src]').first().attr('src') ||
      '';

    const url = toAbs(href, lang);
    out.push({
      titleNo,
      title,
      url,
      lang,
      slug: extractSlug(url) || '',
      thumb,
    });
  });
  return out;
}

/** Convert a possibly-relative webtoons URL to absolute. */
function toAbs(href, lang) {
  if (!href) return '';
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith('/')) return `https://www.webtoons.com${href}`;
  return `https://www.webtoons.com/${lang}/${href}`;
}

export default searchSeries;