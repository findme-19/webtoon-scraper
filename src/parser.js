/**
 * URL & HTML helpers shared by all webtoon modules.
 */
import * as cheerio from 'cheerio';

const VIEWER_RE = /\/viewer\?[^"']*title_no=(\d+)[^"']*episode_no=(\d+)/;
const LIST_RE = /\/list\?[^"']*title_no=(\d+)/;

/**
 * Extract `title_no` from a webtoons URL (supports both list & viewer).
 * @param {string} url
 * @returns {number|null}
 */
export function extractTitleNo(url) {
  const m = String(url).match(/(?:title_no|titleNo)=(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Extract `episode_no` from a viewer URL.
 * @param {string} url
 * @returns {number|null}
 */
export function extractEpisodeNo(url) {
  const m = String(url).match(/(?:episode_no|episodeNo)=(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Match a viewer URL shape string without consuming.
 * Used to spot episode links inside the series list.
 */
export function isViewerUrl(href) {
  return typeof href === 'string' && href.includes('/viewer?') && extractTitleNo(href) !== null;
}

/**
 * Slug (the unique path segment) from a webtoons URL.
 * URL shape: https://www.webtoons.com/<lang>/<genre>/<slug>/list?title_no=N
 * @param {string} url
 * @returns {string|null}
 */
export function extractSlug(url) {
  const m = String(url).match(/webtoons\.com\/[a-z]{2}\/[^/]+\/([^/?]+)/);
  return m ? m[1] : null;
}

/**
 * Sort a set of unique items naturally.
 * @param {Iterable<T>} iterable
 * @returns {T[]}
 */
export function uniq(iterable) {
  return [...new Set(iterable)];
}

/**
 * Load cheerio from HTML/XML.
 * @param {string} html
 * @param {object} [options]  cheerio options (e.g. { xmlMode: true })
 */
export function load(html, options) {
  return cheerio.load(html, options);
}

/** True if the body looks like webtoons' "Connect Error" page. */
export function isConnectError(html) {
  return typeof html === 'string' && /Connect Error :: WEBTOON/.test(html);
}