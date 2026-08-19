/**
 * PDF building from chapter images using pdf-lib (pure JS, no server needed).
 *
 * Webtoon chapters are almost always JPEG; PNG is also handled. Page size is
 * taken from each image's own dimensions so the PDF matches the artwork.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';

/** Detect JPEG/PNG from magic bytes (more reliable than URL/extension). */
export function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  return 'unknown';
}

/**
 * Build a single PDF from image files (in order).
 *
 * @param {(string|Buffer)[]} images  paths or buffers, in page order
 * @param {string} outFile            destination .pdf path
 * @param {object} [opts]
 * @param {string} [opts.title]       PDF title metadata
 * @param {(done:number, total:number) => void} [opts.onProgress]
 * @returns {Promise<{path: string, pages: number, bytes: number}>}
 */
export async function imagesToPdf(images, outFile, opts = {}) {
  const doc = await PDFDocument.create();
  if (opts.title) {
    doc.setTitle(opts.title);
    doc.setProducer('webtoon-scraper');
    doc.setCreator('webtoon-scraper');
  }

  const total = images.length;
  const buffers = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    buffers.push(Buffer.isBuffer(img) ? img : await readFile(img));
  }

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    const type = detectImageType(buf);
    let image;
    try {
      if (type === 'png') image = await doc.embedPng(buf);
      else image = await doc.embedJpg(buf);
    } catch (err) {
      throw new Error(
        `image ${i + 1} (${typeof images[i] === 'string' ? basename(images[i]) : 'buffer'}) is not a decodable ${type === 'png' ? 'PNG' : 'JPEG'}: ${err.message}`,
      );
    }
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    opts.onProgress?.(i + 1, total);
  }

  const bytes = await doc.save();
  await writeFile(outFile, bytes);
  return { path: outFile, pages: buffers.length, bytes: bytes.length };
}

/**
 * Merge several PDF files into one (empty pages removed automatically).
 * @param {string[]} files
 * @param {string} outFile
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @returns {Promise<{path: string, pages: number, bytes: number}>}
 */
export async function mergePdfs(files, outFile, opts = {}) {
  const out = await PDFDocument.create();
  if (opts.title) {
    out.setTitle(opts.title);
    out.setProducer('webtoon-scraper');
    out.setCreator('webtoon-scraper');
  }
  let pages = 0;
  for (const f of files) {
    const src = await PDFDocument.load(await readFile(f));
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const p of copied) out.addPage(p);
    pages += copied.length;
  }
  const bytes = await out.save();
  await writeFile(outFile, bytes);
  return { path: outFile, pages, bytes: bytes.length };
}

export default imagesToPdf;