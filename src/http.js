/**
 * Minimal HTTP client for webtoons.com scraping.
 *
 * Handles the things that make naive `fetch` fails:
 *  - cookie jar (site sets `countryCode`/`locale`/`needCOPPA` cookies on first hit)
 *  - a browser-ish User-Agent
 *  - optional Referer injection (the image CDN REQUIRES it, 403 otherwise)
 *  - polite rate limiting (min delay between requests, jitter)
 *  - retry with backoff on 429 / 5xx / network errors
 *  - response size cap
 */
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const WWW_ORIGIN = 'https://www.webtoons.com';

/**
 * Parse `set-cookie` headers into a Map of name -> value.
 * @param {string|string[]} setCookie
 * @returns {Map<string,string>}
 */
function parseSetCookie(setCookie) {
  const jar = new Map();
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of list) {
    if (!raw) continue;
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

/**
 * Run `fn` (async) with a concurrency pool of `limit` workers over `items`.
 * Results are returned in input order. Errors reject the whole pool.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {{ concurrency?: number }} [options]
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, fn, { concurrency = 4 } = {}) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

export class HttpError extends Error {
  /**
   * @param {number|null} status
   * @param {string} message
   * @param {string} [body]
   */
  constructor(status, message, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** Duck-type check: anything exposing getRaw works as a client (real or mock). */
export function isWebtoonClient(c) {
  return Boolean(c && typeof c.getRaw === 'function');
}

export class WebtoonClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.lang]       two-letter locale, e.g. 'en' | 'id' (default 'en')
   * @param {string} [opts.ua]         custom User-Agent
   * @param {number} [opts.delayMs]    min delay between requests (default 300)
   * @param {number} [opts.jitterMs]   random extra delay (default 150)
   * @param {number} [opts.retries]    retries on 429/5xx/network (default 3)
   * @param {number} [opts.timeoutMs]  per-request timeout (default 20000)
   * @param {number} [opts.maxBytes]   cap on response body (default 25MB)
   */
  constructor(opts = {}) {
    this.lang = opts.lang ?? 'en';
    this.ua = opts.ua ?? DEFAULT_UA;
    this.delayMs = opts.delayMs ?? 300;
    this.jitterMs = opts.jitterMs ?? 150;
    this.retries = opts.retries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
    /** @type {Map<string,string>} */
    this.cookies = new Map();
    this._lastRequestAt = 0;
    this.warmed = false;
  }

  get origin() {
    return WWW_ORIGIN;
  }

  get baseUrl() {
    return `${WWW_ORIGIN}/${this.lang}/`;
  }

  cookieHeader() {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Merge responder cookies into the jar (permissive: keep last value). */
  _storeCookies(res) {
    const setCookie = res.headers.getSetCookie?.() ?? res.headers.get('set-cookie');
    if (!setCookie) return;
    for (const [k, v] of parseSetCookie(setCookie)) this.cookies.set(k, v);
  }

  /**
   * Polite delay: ensures `delayMs + jitter` elapsed since the last call.
   * Only meaningful when options.delayMs > 0.
   * @private
   */
  async _throttle() {
    if (this.delayMs <= 0) return;
    const now = Date.now();
    const wait = this.delayMs + Math.random() * this.jitterMs - (now - this._lastAt);
    if (wait > 0) await sleep(wait);
    this._lastAt = Date.now();
  }

  /**
   * Hit the landing page once so the server hands out session cookies
   * (countryCode/locale/COPPA flags). Call it lazily before page fetches.
   */
  async warmup() {
    if (this.warmed) return;
    await this._throttle();
    const res = await fetch(this.baseUrl, {
      headers: { 'user-agent': this.ua, accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) throw new HttpError(res.status, `warmup failed: HTTP ${res.status}`);
    this._storeCookies(res);
    this.warmed = true;
  }

  /**
   * Low-level GET with retry/backoff/throttle/cap.
   * @param {string} url
   * @param {object} [opts]
   * @param {string} [opts.referer]   Referer header value
   * @param {string} [opts.accept]
   * @returns {Promise<Response>}     resolved `Response`, body NOT consumed
   */
  async getRaw(url, { referer, accept } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this._throttle();
      const headers = { 'user-agent': this.ua };
      if (referer) headers.referer = referer;
      if (accept) headers.accept = accept;
      const cookie = this.cookieHeader();
      if (cookie) headers.cookie = cookie;
      try {
        const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs) });
        this._storeCookies(res);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new HttpError(res.status, `HTTP ${res.status} for ${url}`);
          await sleep(400 * 2 ** attempt + Math.random() * 300);
          continue;
        }
        if (res.status === 403) {
          // 403 could be transient rate limiting, retry once; otherwise let caller handle.
          if (attempt < this.retries) {
            lastErr = new HttpError(403, `HTTP 403 for ${url}`);
            await sleep(500 * 2 ** attempt + Math.random() * 300);
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${url}`);
        return res;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        lastErr = err instanceof Error ? err : new Error(String(err));
        await sleep(500 * 2 ** attempt + Math.random() * 300);
      }
    }
    throw lastErr ?? new HttpError(null, `request failed for ${url}`);
  }

  /**
   * GET and decode to text.
   * @returns {Promise<string>}
   */
  async getText(url, opts = {}) {
    const res = await this.getRaw(url, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...opts });
    const text = await res.text();
    if (text.length > this.maxBytes) throw new HttpError(res.status, `response too big (${text.length}b)`);
    return text;
  }

  /**
   * GET and return raw bytes (for images etc).
   * @returns {Promise<Buffer>}
   */
  async getBuffer(url, opts = {}) {
    const res = await this.getRaw(url, opts);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > this.maxBytes) throw new HttpError(res.status, `response too big (${buf.length}b)`);
    if (buf.length === 0) throw new HttpError(res.status, `empty body for ${url}`);
    return buf;
  }

  /**
   * GET and JSON-parse.
   * @returns {Promise<any>}
   */
  async getJson(url, opts = {}) {
    const text = await this.getText(url, { accept: 'application/json,text/plain,*/*', ...opts });
    return JSON.parse(text);
  }

  _cookieHeader() {
    return this.cookieHeader();
  }
}