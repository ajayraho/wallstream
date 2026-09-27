import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { listZipEntries, ZIP_METHOD_STORED, ZIP_METHOD_DEFLATE } from './zip';
import { streamZipEntry, type ZipVideoRef } from './zipStream';
import { MIME_MAP } from './mime';
import { getCachedMeta, enqueueMetaIndex } from './metaCache';

const app = express();
const PORT = 3001;

const CONFIG_PATH = path.join(process.cwd(), 'wallstream.config.json');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.ogv', '.flv', '.wmv', '.ts'
]);

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'
]);

interface AppConfig {
  folders: string[];
  theme: 'dark' | 'light';
  includeImages?: boolean;
  pauseOnDock?: boolean;
  seekShort?: number;
  seekLong?: number;
}

function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (cfg.includeImages === undefined) cfg.includeImages = false;
      if (cfg.pauseOnDock === undefined) cfg.pauseOnDock = false;
      if (cfg.seekShort === undefined) cfg.seekShort = 5;
      if (cfg.seekLong === undefined) cfg.seekLong = 30;
      return cfg;
    }
  } catch {}
  return { folders: [], theme: 'dark', includeImages: false, pauseOnDock: false, seekShort: 5, seekLong: 30 };
}

function saveConfig(config: AppConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── Live resource stats (for the in-app CPU/RAM monitor) ───────────────────
// Everything here is sampled from Node's own built-ins (process/os) on each
// request; no dependency, no background timers running when nobody is
// looking at the panel.
let lastProcessCpuUsage = process.cpuUsage();
let lastProcessSampleAt = Date.now();
let lastSystemCpuTimes = os.cpus().map(c => ({ ...c.times }));

// CPU time used by *this* Node process since the previous sample, expressed
// as a percentage of a single core (so it can exceed 100% if more than one
// core's worth of work — e.g. concurrent zlib decompression on the libuv
// threadpool — happened in the interval).
function sampleProcessCpuPercent(): number {
  const now = Date.now();
  const elapsedMs = now - lastProcessSampleAt;
  const usage = process.cpuUsage(lastProcessCpuUsage);
  lastProcessCpuUsage = process.cpuUsage();
  lastProcessSampleAt = now;
  if (elapsedMs <= 0) return 0;
  const busyMicros = usage.user + usage.system;
  return Math.max(0, (busyMicros / 1000 / elapsedMs) * 100);
}

// Whole-machine CPU utilization since the previous sample, averaged across
// all cores (0-100).
function sampleSystemCpuPercent(): number {
  const cpus = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  cpus.forEach((cpu, i) => {
    const prev = lastSystemCpuTimes[i] ?? cpu.times;
    const idle = cpu.times.idle - prev.idle;
    const total =
      (cpu.times.user - prev.user) +
      (cpu.times.nice - prev.nice) +
      (cpu.times.sys - prev.sys) +
      (cpu.times.irq - prev.irq) +
      idle;
    idleDelta += idle;
    totalDelta += total;
  });
  lastSystemCpuTimes = cpus.map(c => ({ ...c.times }));
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

interface VideoFile {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  folder: string;
  folderName: string;
  size: number;
  mtime: number;
  type: 'video' | 'image';
  duration?: number;
  width?: number;
  height?: number;
}

// ── Video IDs ──────────────────────────────────────────────────────────────
// A plain filesystem video keeps the original scheme: base64url(absolute path).
// A video that lives inside a zip archive is encoded as base64url of a marker
// plus a small JSON payload carrying everything /api/video/:id needs to locate
// its bytes (zip path, entry name, and the entry's central-directory metadata)
// without re-scanning the archive's central directory on every play request.
const ZIP_ID_MARKER = 'ZIP1\u0000';

function encodeZipId(ref: ZipVideoRef): string {
  return Buffer.from(ZIP_ID_MARKER + JSON.stringify(ref), 'utf-8').toString('base64url');
}

type DecodedId = { kind: 'file'; filePath: string } | { kind: 'zip'; ref: ZipVideoRef };

function decodeId(id: string): DecodedId {
  const raw = Buffer.from(id, 'base64url').toString('utf-8');
  if (raw.startsWith(ZIP_ID_MARKER)) {
    const ref = JSON.parse(raw.slice(ZIP_ID_MARKER.length)) as ZipVideoRef;
    return { kind: 'zip', ref };
  }
  return { kind: 'file', filePath: raw };
}

function scanFolder(rootFolder: string, includeImages: boolean): VideoFile[] {
  const videos: VideoFile[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isVid = VIDEO_EXTENSIONS.has(ext);
        const isImg = IMAGE_EXTENSIONS.has(ext);

        if (isVid || (includeImages && isImg)) {
          try {
            const stat = fs.statSync(fullPath);
            const relativePath = path.relative(rootFolder, fullPath);
            const id = Buffer.from(fullPath).toString('base64url');
            videos.push({
              id,
              name: entry.name,
              path: fullPath,
              relativePath,
              folder: path.dirname(fullPath),
              folderName: path.basename(path.dirname(fullPath)),
              size: stat.size,
              mtime: stat.mtimeMs,
              type: isVid ? 'video' : 'image',
            });
          } catch {}
        }
      }
    }
  }

  walk(rootFolder);
  return videos;
}

// Lists videos (and optionally images) packed inside a .zip archive, without
// extracting anything: only the archive's central directory is read (tiny,
// regardless of how large the archive itself is).
async function scanZipFile(zipPath: string, includeImages: boolean): Promise<VideoFile[]> {
  let entries;
  try {
    entries = await listZipEntries(zipPath);
  } catch (err) {
    console.error(`Failed to read zip archive "${zipPath}":`, (err as Error).message);
    return [];
  }

  let zipMtime = Date.now();
  try {
    zipMtime = fs.statSync(zipPath).mtimeMs;
  } catch {}
  const zipName = path.basename(zipPath);

  const videos: VideoFile[] = [];
  for (const e of entries) {
    if (e.method !== ZIP_METHOD_STORED && e.method !== ZIP_METHOD_DEFLATE) continue; // unsupported compression
    if (e.flags & 0x1) continue; // encrypted entry, can't stream without a password

    const entryName = e.name;
    const ext = path.extname(entryName).toLowerCase();
    const isVid = VIDEO_EXTENSIONS.has(ext);
    const isImg = IMAGE_EXTENSIONS.has(ext);
    if (!isVid && !(includeImages && isImg)) continue;

    const ref: ZipVideoRef = {
      zipPath,
      entryName,
      localHeaderOffset: e.localHeaderOffset,
      compressedSize: e.compressedSize,
      uncompressedSize: e.uncompressedSize,
      method: e.method,
    };

    let duration: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    if (isVid) {
      const cached = getCachedMeta(ref);
      if (cached === undefined) {
        enqueueMetaIndex(ref); // not indexed yet — kick off a background pass, don't block this scan
      } else if (cached) {
        duration = cached.durationSec;
        if (cached.width > 0 && cached.height > 0) {
          width = cached.width;
          height = cached.height;
        }
      }
    }

    videos.push({
      id: encodeZipId(ref),
      name: path.basename(entryName),
      path: `${zipPath}::${entryName}`,
      relativePath: entryName,
      folder: zipPath,
      folderName: zipName,
      size: e.uncompressedSize,
      mtime: e.modifiedMs || zipMtime, // prefer the entry's own timestamp; fall back to the archive's if unparseable
      type: isVid ? 'video' : 'image',
      duration,
      width,
      height,
    });
  }
  return videos;
}

// Enable CORS for dev environment, but unnecessary in production since we host on the exact same port
app.use(cors());
app.use(express.json());

// Serve static React production build
const DIST_PATH = path.join(process.cwd(), 'dist');
if (fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));
}

// GET config
app.get('/api/config', (_req, res) => {
  res.json(loadConfig());
});

// POST config
app.post('/api/config', (req, res) => {
  const config = req.body as AppConfig;
  saveConfig(config);
  res.json({ ok: true });
});

// GET videos list
app.get('/api/videos', async (_req, res) => {
  try {
    const config = loadConfig();
    const all: VideoFile[] = [];
    for (const folder of config.folders) {
      if (!fs.existsSync(folder)) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(folder);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        all.push(...scanFolder(folder, config.includeImages || false));
      } else if (st.isFile() && path.extname(folder).toLowerCase() === '.zip') {
        all.push(...await scanZipFile(folder, config.includeImages || false));
      }
    }
    // deduplicate by id
    const seen = new Set<string>();
    const unique = all.filter(v => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
    res.json(unique);
  } catch (err) {
    console.error('Failed to list videos:', err);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// Stream video
app.get('/api/video/:id', async (req, res) => {
  const { id } = req.params;
  let decoded: DecodedId;
  try {
    decoded = decodeId(id);
  } catch {
    res.status(400).send('Invalid ID');
    return;
  }

  if (decoded.kind === 'zip') {
    try {
      await streamZipEntry(decoded.ref, req, res);
    } catch (err) {
      console.error('Failed to stream zip entry:', err);
      if (!res.headersSent) res.status(500).send('Failed to stream archive entry');
    }
    return;
  }

  const filePath = decoded.filePath;

  if (!fs.existsSync(filePath)) {
    res.status(404).send('Not found');
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext] || 'application/octet-stream';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// GET live CPU/RAM stats (server process + whole machine)
app.get('/api/stats', (_req, res) => {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  res.json({
    timestamp: Date.now(),
    process: {
      cpuPercent: sampleProcessCpuPercent(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    },
    system: {
      cpuPercent: sampleSystemCpuPercent(),
      usedMem: totalMem - freeMem,
      totalMem,
      cores: os.cpus().length,
      loadavg: os.loadavg(),
    },
  });
});

// GET playlists
app.get('/api/playlists', (_req, res) => {
  const p = path.join(process.cwd(), 'wallstream.playlists.json');
  if (fs.existsSync(p)) {
    res.json(JSON.parse(fs.readFileSync(p, 'utf-8')));
  } else {
    res.json([]);
  }
});

// POST playlists
app.post('/api/playlists', (req, res) => {
  const p = path.join(process.cwd(), 'wallstream.playlists.json');
  fs.writeFileSync(p, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// Catch-all middleware for React Single Page App routing (avoids Express 5 PathError)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (fs.existsSync(DIST_PATH)) {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  } else {
    res.status(404).send('WallStream production build not found. Please run npm run build first.');
  }
});

app.listen(PORT, () => {
  console.log(`WallStream server running at http://localhost:${PORT}`);
});
