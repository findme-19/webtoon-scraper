/**
 * Episode-level operations: extract the ordered list of chapter images
 * from a viewer page.
 *
 * Webtoons renders chapter images as lazy-loaded `<img class="_images">`
 * elements whose real URL lives in the `data-url` attribute. The attribute
 * order equals reading order.
 */
import { WebtoonClient, isWebtoonClient } from './http.js';
import { load, extractTitleNo, extractEpisodeNo, uniq } from './parser.js';

/**
 * @typedef {object} Episode
 * @property {number} titleNo
 * @property {number} episodeNo
 * @property {string} title
 * @property {string} url
 * @property {string[]} images  ORIGINAL CDN URLs in reading order
 * @property {string} lang
 */

/**
 * Get the image list for one episode.
 * @param {string} url  the viewer URL
 * @param {object} [opts]
 * @param {WebtoonClient} [opts.client]
 * @param {string} [opts.lang='en']
 * @returns {Promise<Episode>}
 */
export async function getEpisodeImages(url, { client, lang } = {}) {
  const c = isWebtoonClient(client) ? client : new WebtoonClient({ lang: lang ?? 'en' });
  if (!c.warmed) await c.warmup();
  const titleNo = extractTitleNo(url);
  const episodeNo = extractEpisodeNo(url);
  if (!titleNo || !episodeNo) throw new TypeError(`not a viewer URL: ${url}`);

  const html = await c.getText(url, { referer: c.baseUrl });
  return parseEpisodeImages(html, { url, titleNo, episodeNo, lang: c.lang });
}

/**
 * Parse a viewer page into an Episode.
 * @param {string} html
 * @param {object} [meta]
 * @param {string} [meta.url]
 * @param {number} [meta.titleNo]
 * @param {number} [meta.episodeNo]
 * @param {string} [meta.lang]
 * @returns {Episode}
 */
export function parseEpisodeImages(html, meta = {}) {
  const $ = load(html);
  const images = [];

  $('._images').each((_, el) => {
    const dataUrl = $(el).attr('data-url');
    if (!dataUrl) return;
    // Some pages carry tiny transparent placeholder URLs in data-url;
    // keep only CDN image URLs (jpg/png/webp).
    if (/\.(jpe?g|png|webp)([?#]|$)/i.test(dataUrl)) images.push(dataUrl);
  });
  // Some viewers store the list in a JSON blob instead; _imageList/_images
  // arrays are accessed via embedded <script> vars, rarely needed in practice.
  const uniqImages = uniq(images);

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() || $('title').first().text().trim() || '';

  return {
    titleNo: meta.titleNo ?? extractTitleNo(meta.url ?? '') ?? null,
    episodeNo: meta.episodeNo ?? extractEpisodeNo(meta.url ?? '') ?? null,
    title,
    url: meta.url ?? '',
    images: uniqImages,
    lang: meta.lang ?? 'en',
  };
}

export default getEpisodeImages;