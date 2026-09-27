// One-time-per-video metadata cache for videos living inside a zip archive.
//
// Computing a video's duration/dimensions from a DEFLATE zip entry whose
// `moov` box sits at the end of the file means decompressing the whole thing
// sequentially once (see mp4meta.ts). That's fine to pay ONCE, in the
// background, never on the hot path of listing or scrolling a library. This
// module persists the result to disk (keyed to the exact entry, so a
// rebuilt/replaced archive just misses the cache and recomputes) and runs a
// small concurrency-limited queue so a freshly-added 100GB archive doesn't
// try to index everything at once and peg the CPU.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { getEntryDataOffset, ZIP_METHOD_STORED, ZIP_METHOD_DEFLATE } from './zip';
import { StreamByteSource, extractMp4Meta, type Mp4Meta } from './mp4meta';
import type { ZipVideoRef } from './zipStream';

// Only ISO-base-media containers use the box format mp4meta.ts understands.
// Everything else (mkv/webm/avi/wmv/ogv/flv/ts) falls back to the browser's
// own metadata probing, same as before this cache existed.
const MP4_LIKE_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']);

const CACHE_DIR = path.join(process.cwd(), '.wallstream-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'video-meta.json');
const CONCURRENCY = 2;

type CacheValue = Mp4Meta | null; // null = "we tried and found nothing usable" (still worth remembering, so we don't retry every scan)

let cache: Map<string, CacheValue> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function loadCache(): Map<string, CacheValue> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, CacheValue>;
    for (const [k, v] of Object.entries(obj)) cache.set(k, v);
  } catch {
    // no cache yet, or unreadable — start fresh
  }
  return cache;
}

function scheduleSave(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const obj: Record<string, CacheValue> = {};
      for (const [k, v] of loadCache()) obj[k] = v;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
    } catch (err) {
      console.error('Failed to persist video-meta cache:', (err as Error).message);
    }
  }, 500);
}

function cacheKey(ref: ZipVideoRef): string {
  return `${ref.zipPath}|${ref.entryName}|${ref.localHeaderOffset}|${ref.uncompressedSize}`;
}

export function isMp4Like(entryName: string): boolean {
  return MP4_LIKE_EXTENSIONS.has(path.extname(entryName).toLowerCase());
}

/** Non-blocking: returns the cached result if we have one (including a
 *  cached "null" for a previously-failed/unsupported entry), or undefined if
 *  it hasn't been computed yet. Never touches the archive itself. */
export function getCachedMeta(ref: ZipVideoRef): CacheValue | undefined {
  return loadCache().get(cacheKey(ref));
}

async function computeZipEntryMeta(ref: ZipVideoRef): Promise<Mp4Meta | null> {
  if (!fs.existsSync(ref.zipPath)) return null;

  let dataOffset: number;
  try {
    const fh = await fs.promises.open(ref.zipPath, 'r');
    try {
      dataOffset = await getEntryDataOffset(fh, ref.localHeaderOffset);
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }

  let rawStream: fs.ReadStream | null = null;
  let source: StreamByteSource | null = null;
  try {
    if (ref.method === ZIP_METHOD_STORED) {
      rawStream = fs.createReadStream(ref.zipPath, { start: dataOffset, end: dataOffset + ref.uncompressedSize - 1 });
      source = new StreamByteSource(rawStream);
    } else if (ref.method === ZIP_METHOD_DEFLATE) {
      rawStream = fs.createReadStream(ref.zipPath, { start: dataOffset, end: dataOffset + ref.compressedSize - 1 });
      const inflate = zlib.createInflateRaw();
      source = new StreamByteSource(rawStream.pipe(inflate));
    } else {
      return null;
    }
    return await extractMp4Meta(source);
  } catch (err) {
    console.error(`Failed to index metadata for "${ref.entryName}":`, (err as Error).message);
    return null;
  } finally {
    source?.destroy();
    rawStream?.destroy();
  }
}

const queue: ZipVideoRef[] = [];
const queued = new Set<string>();
let activeWorkers = 0;

function pump(): void {
  while (activeWorkers < CONCURRENCY && queue.length > 0) {
    const ref = queue.shift()!;
    const key = cacheKey(ref);
    queued.delete(key);
    activeWorkers++;
    computeZipEntryMeta(ref)
      .then(meta => {
        loadCache().set(key, meta);
        scheduleSave();
      })
      .catch(() => {
        loadCache().set(key, null);
        scheduleSave();
      })
      .finally(() => {
        activeWorkers--;
        pump();
      });
  }
}

/** Fire-and-forget: queue an entry for background indexing if it's a
 *  supported container and we don't already have (or are computing) a result. */
export function enqueueMetaIndex(ref: ZipVideoRef): void {
  if (!isMp4Like(ref.entryName)) return;
  const key = cacheKey(ref);
  if (loadCache().has(key) || queued.has(key)) return;
  queued.add(key);
  queue.push(ref);
  pump();
}
