import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

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
app.get('/api/videos', (_req, res) => {
  const config = loadConfig();
  const all: VideoFile[] = [];
  for (const folder of config.folders) {
    if (fs.existsSync(folder)) {
      all.push(...scanFolder(folder, config.includeImages || false));
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
});

// Stream video
app.get('/api/video/:id', (req, res) => {
  const { id } = req.params;
  let filePath: string;
  try {
    filePath = Buffer.from(id, 'base64url').toString('utf-8');
  } catch {
    res.status(400).send('Invalid ID');
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).send('Not found');
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/mp4',
    '.ogv': 'video/ogg',
    '.flv': 'video/x-flv',
    '.wmv': 'video/x-ms-wmv',
    '.ts': 'video/mp2t',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

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
