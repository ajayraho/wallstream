// Minimal MP4/MOV ("ISO base media") box parser.
//
// Purpose: get a video's duration + dimensions without needing the browser to
// open a <video> element at all. That matters specifically for videos living
// inside a DEFLATE zip entry whose `moov` (metadata) box sits at the END of
// the file — extremely common for files that weren't specifically re-muxed
// for web streaming. Reaching that box means decompressing the file
// sequentially from the start, exactly once; this module does that walk and
// nothing else (no thumbtail/frame decoding, no re-encoding, no writing
// anything back to the source file).
//
// This is meant to run as a one-time background job per video (see
// metaCache.ts), never on the request path for listing or playback.

import type { Readable } from 'stream';

export interface Mp4Meta {
  durationSec: number;
  width: number;
  height: number;
}

/** Sequential-only byte reader over a Node Readable stream (works for a plain
 *  file stream or a live zlib inflate pipeline — either way, forward-only). */
export class StreamByteSource {
  private iterator: AsyncIterator<Buffer>;
  private leftover: Buffer = Buffer.alloc(0);
  private done = false;

  constructor(private stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  private async fill(): Promise<boolean> {
    if (this.done) return false;
    const { value, done } = await this.iterator.next();
    if (done) {
      this.done = true;
      return false;
    }
    this.leftover = this.leftover.length ? Buffer.concat([this.leftover, value]) : value;
    return true;
  }

  async read(n: number): Promise<Buffer | null> {
    while (this.leftover.length < n) {
      const more = await this.fill();
      if (!more) break;
    }
    if (this.leftover.length === 0) return null;
    const take = Math.min(n, this.leftover.length);
    const out = this.leftover.subarray(0, take);
    this.leftover = this.leftover.subarray(take);
    return out;
  }

  async skip(n: number): Promise<boolean> {
    let remaining = n;
    if (this.leftover.length > 0) {
      const take = Math.min(remaining, this.leftover.length);
      this.leftover = this.leftover.subarray(take);
      remaining -= take;
    }
    while (remaining > 0) {
      const more = await this.fill();
      if (!more) return false;
      const take = Math.min(remaining, this.leftover.length);
      this.leftover = this.leftover.subarray(take);
      remaining -= take;
    }
    return true;
  }

  destroy(): void {
    this.stream.destroy();
  }
}

interface BoxRange {
  type: string;
  start: number;
  end: number;
}

function readBoxes(buf: Buffer): BoxRange[] {
  const boxes: BoxRange[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    let headerLen = 8;
    if (size === 1) {
      if (i + 16 > buf.length) break;
      size = Number(buf.readBigUInt64BE(i + 8));
      headerLen = 16;
    } else if (size === 0) {
      size = buf.length - i;
    }
    if (size < headerLen || i + size > buf.length) break;
    boxes.push({ type, start: i + headerLen, end: i + size });
    i += size;
  }
  return boxes;
}

function parseMvhd(buf: Buffer): { timescale: number; duration: number } | null {
  if (buf.length < 4) return null;
  const version = buf.readUInt8(0);
  if (version === 1) {
    if (buf.length < 32) return null;
    const timescale = buf.readUInt32BE(20);
    const duration = Number(buf.readBigUInt64BE(24));
    return { timescale, duration };
  }
  if (buf.length < 20) return null;
  const timescale = buf.readUInt32BE(12);
  const duration = buf.readUInt32BE(16);
  return { timescale, duration };
}

function parseTkhd(buf: Buffer): { width: number; height: number } | null {
  // width/height are always the trailing 8 bytes of tkhd (4 bytes each, 16.16 fixed point),
  // regardless of tkhd version.
  if (buf.length < 8) return null;
  const width = buf.readUInt32BE(buf.length - 8) / 65536;
  const height = buf.readUInt32BE(buf.length - 4) / 65536;
  return { width, height };
}

function parseMoov(moovBuf: Buffer): Mp4Meta | null {
  const children = readBoxes(moovBuf);
  const mvhdBox = children.find(b => b.type === 'mvhd');
  if (!mvhdBox) return null;
  const mvhd = parseMvhd(moovBuf.subarray(mvhdBox.start, mvhdBox.end));
  if (!mvhd || mvhd.timescale === 0) return null;
  const durationSec = mvhd.duration / mvhd.timescale;

  let width = 0;
  let height = 0;
  for (const child of children) {
    if (child.type !== 'trak') continue;
    const trakBuf = moovBuf.subarray(child.start, child.end);
    const tkhdBox = readBoxes(trakBuf).find(b => b.type === 'tkhd');
    if (!tkhdBox) continue;
    const dims = parseTkhd(trakBuf.subarray(tkhdBox.start, tkhdBox.end));
    // Audio-only tracks report zero width/height in tkhd — skip past those to
    // find the video track without needing to inspect the handler type.
    if (dims && dims.width > 0 && dims.height > 0) {
      width = dims.width;
      height = dims.height;
      break;
    }
  }
  return { durationSec, width, height };
}

// Safety cap so a malformed/non-MP4 file can't make us scan forever.
const MAX_SEARCH_BYTES = 2 * 1024 * 1024 * 1024;

/** Walk top-level boxes until `moov` is found (or give up), returning its
 *  parsed duration/dimensions. Returns null on anything unexpected — never throws. */
export async function extractMp4Meta(source: StreamByteSource): Promise<Mp4Meta | null> {
  let consumed = 0;
  while (true) {
    const header = await source.read(8);
    if (!header || header.length < 8) return null;
    consumed += 8;
    let size = header.readUInt32BE(0);
    const type = header.toString('ascii', 4, 8);
    let headerLen = 8;
    if (size === 1) {
      const ext = await source.read(8);
      if (!ext || ext.length < 8) return null;
      consumed += 8;
      size = Number(ext.readBigUInt64BE(0));
      headerLen = 16;
    } else if (size === 0) {
      return null; // box extends to EOF with unknown length up front — bail
    }
    const bodyLen = size - headerLen;
    if (bodyLen < 0) return null;
    if (type === 'moov') {
      const body = await source.read(bodyLen);
      if (!body || body.length < bodyLen) return null;
      return parseMoov(body);
    }
    const ok = await source.skip(bodyLen);
    if (!ok) return null;
    consumed += bodyLen;
    if (consumed > MAX_SEARCH_BYTES) return null;
  }
}
