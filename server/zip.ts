// Zero-copy ZIP central-directory reader + byte-range resolver.
//
// Lets us list and play videos that live inside a (possibly enormous) .zip
// archive without ever extracting it to disk or reading it into memory.
// Only the End-Of-Central-Directory record and the Central Directory itself
// are read to build a listing — both are tiny (proportional to entry count,
// not archive size), no matter how large the archive is.
//
// Supports ZIP64, which matters here even though the archive's *entry count*
// rarely needs it: once the archive passes ~4GB, local file header offsets
// for entries near the end exceed the 32-bit field's range on their own, so
// per-entry ZIP64 extra fields show up well before the archive nears 100GB.
//
// No external dependencies.

import fs from 'fs';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export const ZIP_METHOD_STORED = 0;
export const ZIP_METHOD_DEFLATE = 8;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  flags: number;
  /** This entry's own last-modified time, from the zip's MS-DOS-format timestamp
   *  (2-second resolution, no timezone — a limitation of the zip format itself,
   *  interpreted as local time same as most zip tools do). 0 if unparseable. */
  modifiedMs: number;
}

async function readAt(fh: fs.promises.FileHandle, length: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) {
    throw new Error(`Short read at offset ${position}: wanted ${length} bytes, got ${bytesRead}`);
  }
  return buf;
}

/** Locate and parse the End Of Central Directory record, resolving ZIP64 fields if present. */
async function readEOCD(fh: fs.promises.FileHandle, fileSize: number): Promise<{ cdSize: number; cdOffset: number }> {
  const maxTail = Math.min(fileSize, 22 + 65535);
  const tailStart = fileSize - maxTail;
  const tail = await readAt(fh, maxTail, tailStart);

  let eo = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) { eo = i; break; }
  }
  if (eo === -1) throw new Error('Not a ZIP file (EOCD signature not found)');

  let totalEntries = tail.readUInt16LE(eo + 10);
  let cdSize = tail.readUInt32LE(eo + 12);
  let cdOffset = tail.readUInt32LE(eo + 16);

  const eocdAbsOffset = tailStart + eo;
  const needsZip64 = totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;

  if (needsZip64 && eocdAbsOffset >= 20) {
    const locatorOffset = eocdAbsOffset - 20;
    const loc = await readAt(fh, 20, locatorOffset);
    if (loc.readUInt32LE(0) === EOCD64_LOC_SIG) {
      const zip64EocdOffset = Number(loc.readBigUInt64LE(8));
      const z64 = await readAt(fh, 56, zip64EocdOffset);
      if (z64.readUInt32LE(0) === EOCD64_SIG) {
        cdSize = Number(z64.readBigUInt64LE(40));
        cdOffset = Number(z64.readBigUInt64LE(48));
      }
    }
  }

  return { cdSize, cdOffset };
}

/** Converts a zip's MS-DOS date+time fields (2-second resolution, no timezone)
 *  into a regular JS epoch-ms timestamp. Returns 0 if the fields look unset. */
function dosDateTimeToMs(dosDate: number, dosTime: number): number {
  if (dosDate === 0) return 0;
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = (dosDate >> 5) & 0x0f; // 1-12
  const day = dosDate & 0x1f;
  const hour = (dosTime >> 11) & 0x1f;
  const minute = (dosTime >> 5) & 0x3f;
  const second = (dosTime & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
  const ms = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Parse every Central Directory File Header into a flat entry list. */
function parseCentralDirectory(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= buf.length) {
    if (buf.readUInt32LE(p) !== CD_SIG) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const lastModTime = buf.readUInt16LE(p + 12);
    const lastModDate = buf.readUInt16LE(p + 14);
    let compressedSize = buf.readUInt32LE(p + 20);
    let uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localHeaderOffset = buf.readUInt32LE(p + 42);

    const nameStart = p + 46;
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);
    const extraStart = nameStart + nameLen;
    const extraEnd = extraStart + extraLen;

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let ep = extraStart;
      while (ep + 4 <= extraEnd) {
        const tag = buf.readUInt16LE(ep);
        const size = buf.readUInt16LE(ep + 2);
        if (tag === 0x0001) {
          // Per APPNOTE.TXT: only the fields that were actually 0xFFFFFFFF in the fixed
          // header are present here, in this fixed order (uncompressed, compressed, offset).
          let dp = ep + 4;
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(buf.readBigUInt64LE(dp)); dp += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(buf.readBigUInt64LE(dp)); dp += 8; }
          if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(buf.readBigUInt64LE(dp)); dp += 8; }
          break;
        }
        ep += 4 + size;
      }
    }

    entries.push({
      name, method, compressedSize, uncompressedSize, localHeaderOffset, flags,
      modifiedMs: dosDateTimeToMs(lastModDate, lastModTime),
    });
    p = extraEnd + commentLen;
  }
  return entries;
}

/**
 * Read the full entry list of a ZIP file without touching any of its file data —
 * only the (tiny) EOCD + central directory are read, regardless of archive size.
 */
export async function listZipEntries(zipPath: string): Promise<ZipEntry[]> {
  const fh = await fs.promises.open(zipPath, 'r');
  try {
    const stat = await fh.stat();
    const { cdSize, cdOffset } = await readEOCD(fh, stat.size);
    const cdBuf = await readAt(fh, cdSize, cdOffset);
    return parseCentralDirectory(cdBuf).filter(e => !e.name.endsWith('/'));
  } finally {
    await fh.close();
  }
}

/**
 * Resolve the exact byte offset (within the ZIP file) where an entry's data begins.
 * Requires one small read of the Local File Header — its filename/extra-field length
 * can differ from the central directory's copy, so the data offset can't be assumed.
 */
export async function getEntryDataOffset(fh: fs.promises.FileHandle, localHeaderOffset: number): Promise<number> {
  const buf = await readAt(fh, 30, localHeaderOffset);
  if (buf.readUInt32LE(0) !== LFH_SIG) {
    throw new Error(`Bad local file header at offset ${localHeaderOffset}`);
  }
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  return localHeaderOffset + 30 + nameLen + extraLen;
}
