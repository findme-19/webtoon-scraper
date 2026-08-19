/**
 * webtoon-scraper — public API.
 *
 * ```js
 * import * as Webtoon from './src/index.js';
 * const results = await Webtoon.searchSeries('tower of god');
 * const series = await Webtoon.getChapterList(results[0].url);
 * const ep     = await Webtoon.getEpisodeImages(series.chapters[0].url);
 * await Webtoon.downloadImages(ep.images, './out');
 * await Webtoon.imagesToPdf(await import('node:fs').then(fs => fs.readdir('./out')), 'out.pdf');
 * ```
 */
export { WebtoonClient, HttpError, mapLimit, isWebtoonClient, DEFAULT_UA } from './http.js';
export { searchSeries, parseSearchResults } from './search.js';
export { getChapterList, parseSeriesList, parseRss } from './series.js';
export { getEpisodeImages, parseEpisodeImages } from './episode.js';
export { downloadImages, safeImageName, downloadToPdf } from './downloader.js';
export { imagesToPdf, mergePdfs, detectImageType } from './pdf.js';
export { extractTitleNo, extractEpisodeNo, extractSlug } from './parser.js';