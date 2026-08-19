/**
 * Image downloader with politeness, concurrency and resume support.
 *
 * The webtoon CDN (webtoon-phinf.pstatic.net) returns 403 unless the request
 * carries a `Referer` on webtoons.com — every download must set it.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { WebtoonClient, isWebtoonClient, mapLimit } from './http.js';

/** Safe filename from a CDN URL path (keeps a short hash to avoid collisions). */
export function safeImageName(url, index) {
  const name = basename(new URL(url).pathname);
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${String(index).padStart(3, '0')}_${clean}`;
}

/**
 * Download a list of image URLs into `dir`.
 *
 * Existing files are skipped (resume-friendly). Returns absolute paths.
 *
 * @param {string[]} urls
 * @param {string} dir
 * @param {object} [opts]
 * @param {WebtoonClient|string} [opts.client]   client; or a referer URL string (used to build a client)
 * @param {number} [opts.concurrency=4]
 * @param {number} [opts.delayMs=120]           extra delay between image requests
 * @param {(done:number, total:number) => void} [opts.onProgress]
 * @param {(url:string, path:string) => void} [opts.onSaved]
 * @returns {Promise<string[]>}
 */
export async function downloadImages(urls, dir, opts = {}) {
  const c =
    isWebtoonClient(opts.client)
      ? opts.client
      : new WebtoonClient({ delayMs: opts.delayMs ?? 120 });
  const referer = opts.referer || c.baseUrl;
  await mkdir(dir, { recursive: true });

  const concurrency = opts.concurrency ?? 4;
  const total = urls.length;
  let done = 0;

  const out = await mapLimit(
    urls,
    async (url, i) => {
      const name = safeImageName(url, i);
      const dest = join(dir, name);
      try {
        const st = await stat(dest);
        if (st.size > 0) {
          done++;
          opts.onProgress?.(done, total);
          opts.onSaved?.(url, dest);
          return dest; // resume: already downloaded
        }
      } catch {
        /* not present yet */
      }
      const buf = await c.getBuffer(url, { referer });
      await writeFile(dest, buf);
      done++;
      opts.onProgress?.(done, total);
      opts.onSaved?.(url, dest);
      return dest;
    },
    { concurrency },
  );
  return out;
}

/**
 * Download images then immediately build a PDF (one-shot helper).
 */
export async function downloadToPdf(urls, dir, outFile, opts = {}) {
  const paths = await downloadImages(urls, dir, opts);
  const { imagesToPdf } = await import('./pdf.js');
  return imagesToPdf(paths, outFile, opts);
}

export default downloadImages;