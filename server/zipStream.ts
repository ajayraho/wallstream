// HTTP range-request handler for videos living inside a ZIP archive.
//
// - STORED entries (no compression — the common case for archives of
//   already-compressed video files): the requested byte range maps 1:1 onto
//   a byte range of the ZIP file itself. We serve it with a plain OS-level
//   file range read — zero decompression, zero buffering, true random seek,
//   identical cost whether the archive is 1GB or 100GB.
// - DEFLATE entries: DEFLATE isn't a seekable format, so we decompress
//   sequentially from the start of the entry using Node's built-in zlib
//   streaming inflater. We never hold more than a small chunk in memory
//   (never "load the whole file into RAM"), and the moment we've produced
//   the requested range we destroy the underlying streams so we don't waste
//   CPU decompressing the rest of a huge file just to discard it. Seeking
//   near the end of a large deflated file still costs a sequential
//   decompress-from-start, which is the fundamental trade-off of DEFLATE;
//   storing already-compressed video as STORED avoids it entirely.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Transform } from 'stream';
import type { Request, Response } from 'express';
import { getEntryDataOffset, ZIP_METHOD_STORED, ZIP_METHOD_DEFLATE } from './zip';
import { MIME_MAP } from './mime';

export interface ZipVideoRef {
  zipPath: string;
  entryName: string;
  localHeaderOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
}

export async function streamZipEntry(ref: ZipVideoRef, req: Request, res: Response): Promise<void> {
  const { zipPath, entryName, localHeaderOffset, compressedSize, uncompressedSize, method } = ref;

  if (!fs.existsSync(zipPath)) {
    res.status(404).send('Archive not found');
    return;
  }

  let dataOffset: number;
  try {
    const fh = await fs.promises.open(zipPath, 'r');
    try {
      dataOffset = await getEntryDataOffset(fh, localHeaderOffset);
    } finally {
      await fh.close();
    }
  } catch (err) {
    console.error(`Failed to resolve zip entry "${entryName}" in "${zipPath}":`, (err as Error).message);
    res.status(500).send('Failed to read archive entry');
    return;
  }

  const ext = path.extname(entryName).toLowerCase();
  const contentType = MIME_MAP[ext] || 'application/octet-stream';
  const fileSize = uncompressedSize;
  const rangeHeader = req.headers.range;

  let start = 0;
  let end = fileSize - 1;
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const parsedStart = parseInt(parts[0], 10);
    const parsedEnd = parts[1] ? parseInt(parts[1], 10) : NaN;
    start = Number.isFinite(parsedStart) ? parsedStart : 0;
    end = Number.isFinite(parsedEnd) ? parsedEnd : fileSize - 1;
  }
  if (end > fileSize - 1) end = fileSize - 1;

  if (fileSize <= 0 || start > end || start < 0) {
    res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    return;
  }

  const chunkSize = end - start + 1;
  const status = rangeHeader ? 206 : 200;
  const headers: Record<string, string | number> = {
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': contentType,
  };
  if (rangeHeader) headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
  res.writeHead(status, headers);

  if (method === ZIP_METHOD_STORED) {
    const raw = fs.createReadStream(zipPath, { start: dataOffset + start, end: dataOffset + end });
    raw.on('error', (err) => { console.error('zip stored stream error:', err.message); res.destroy(); });
    req.on('close', () => raw.destroy());
    raw.pipe(res);
    return;
  }

  if (method === ZIP_METHOD_DEFLATE) {
    const raw = fs.createReadStream(zipPath, { start: dataOffset, end: dataOffset + compressedSize - 1 });
    const inflate = zlib.createInflateRaw();
    let pos = 0;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      raw.destroy();
      inflate.destroy();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    raw.on('error', (err) => { console.error('zip deflate raw stream error:', err.message); cleanup(); res.destroy(); });
    inflate.on('error', (err) => { console.error('zip inflate error:', err.message); cleanup(); res.destroy(); });

    const windowFilter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (finished) return cb();
        const chunkStart = pos;
        const chunkEnd = pos + chunk.length - 1;
        pos += chunk.length;

        if (chunkEnd < start) return cb(); // still before the requested window

        if (chunkStart > end) { // fully past the requested window: stop for good
          this.push(null);
          cleanup();
          return cb();
        }

        const sliceStart = Math.max(0, start - chunkStart);
        const sliceEnd = Math.min(chunk.length, end - chunkStart + 1);
        this.push(chunk.subarray(sliceStart, sliceEnd));

        if (chunkEnd >= end) {
          this.push(null);
          cleanup();
        }
        cb();
      },
    });

    raw.pipe(inflate).pipe(windowFilter).pipe(res);
    return;
  }

  res.status(415).send(`Unsupported compression method (${method}) for this archive entry`);
}
