import { useState, useMemo, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import type { VideoFile } from '../types';
import VideoCard from '../components/VideoCard';
import ContextMenu from '../components/ContextMenu';
import PlaylistModal from '../components/PlaylistModal';

export default function Library() {
  const { state, dispatch, updatePlaylists } = useStore();
  const { videos, playlists, search, sortMode, viewMode, gridSize, loading, error } = state;

  const [cols, setCols] = useState(4);
  const [ctx,         setCtx]         = useState<{ x: number; y: number; video: VideoFile } | null>(null);
  const [plModal,     setPlModal]     = useState<{ videoId?: string } | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  /* ── Filtered + sorted ── */
  const filtered = useMemo(() => {
    let list = [...videos];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(v => v.name.toLowerCase().includes(q) || v.relativePath.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      switch (sortMode) {
        case 'name':   return a.name.localeCompare(b.name);
        case 'size':   return b.size - a.size;
        case 'folder': return a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name);
        case 'date':
        default:       return b.mtime - a.mtime;
      }
    });
    return list;
  }, [videos, search, sortMode]);

  /* ── Grouped + Visual Queue ── */
  const grouped = useMemo(() => {
    if (viewMode === 'grid') return null;
    return filtered.reduce<Record<string, VideoFile[]>>((acc, v) => {
      const k = v.folder;
      (acc[k] = acc[k] || []).push(v);
      return acc;
    }, {});
  }, [filtered, viewMode]);

  const visualQueue = useMemo(() => {
    return grouped ? Object.values(grouped).flat() : filtered;
  }, [filtered, grouped]);

  /* ── Add to playlist ── */
  const addToPlaylist = useCallback((videoId: string, playlistId: string) => {
    const updated = playlists.map(p =>
      p.id === playlistId && !p.videoIds.includes(videoId)
        ? { ...p, videoIds: [...p.videoIds, videoId] }
        : p
    );
    updatePlaylists(updated);
  }, [playlists, updatePlaylists]);

  const toggleFolder = (folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  /* ── Grid ── */
  // Responsive column count
  useEffect(() => {
    const calcCols = () => {
      const w = window.innerWidth;
      const base = gridSize === 'small' ? 5 : gridSize === 'medium' ? 4 : 3;
      if (w < 900) setCols(Math.max(1, base - 2));
      else if (w < 1400) setCols(Math.max(2, base - 1));
      else setCols(base);
    };
    calcCols();
    window.addEventListener('resize', calcCols);
    return () => window.removeEventListener('resize', calcCols);
  }, [gridSize]);

  /* ── Loading / error ── */
  if (loading) return (
    <main className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Scanning your videos…</p>
      </div>
    </main>
  );

  if (error) return (
    <main className="page">
      <div style={{ background: 'rgba(255,77,106,0.08)', border: '1px solid rgba(255,77,106,0.25)', borderRadius: 12, padding: '16px 20px', color: '#ff4d6a', fontSize: 13.5 }}>
        ⚠ {error}
      </div>
    </main>
  );

  if (!loading && videos.length === 0) return (
    <main className="page">
      <div className="empty">
        <div className="empty-icon">🎬</div>
        <h3>No videos found</h3>
        <p>Go to Settings and add the folders where your videos live. WallStream will scan all subfolders automatically.</p>
      </div>
    </main>
  );

  // JS Masonry Renderer
  const renderGrid = (list: VideoFile[], offset = 0) => {
    const columnData: VideoFile[][] = Array.from({ length: cols }, () => []);
    list.forEach((v, i) => columnData[i % cols].push(v));

    return (
      <div className={`grid-masonry ${gridSize}`}>
        {columnData.map((colItems, cIdx) => (
          <div key={cIdx} className="grid-col">
            {colItems.map((v, i) => (
              <VideoCard
                key={v.id}
                video={v}
                index={offset + i * cols + cIdx}
                onOpen={() => {
                  const actualIndex = visualQueue.findIndex(x => x.id === v.id);
                  dispatch({ type: 'PLAY_QUEUE', payload: { queue: visualQueue, index: Math.max(0, actualIndex) } });
                }}
                onCtx={(e, v) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, video: v }); }}
                onAddPlaylist={v => setPlModal({ videoId: v.id })}
              />
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <main className="page">
      {viewMode === 'grid' || !grouped
        ? renderGrid(filtered)
        : (() => {
            let offset = 0;
            return Object.entries(grouped).map(([folder, vids]) => {
              const el = (
                <div key={folder} className="folder-group">
                  <div 
                    className="folder-hdr" 
                    style={{ cursor: 'pointer', userSelect: 'none', transition: 'border-color 0.2s', borderColor: collapsedFolders.has(folder) ? 'transparent' : 'var(--border)' }} 
                    onClick={() => toggleFolder(folder)}
                    title="Toggle folder visibility"
                  >
                    <span style={{ fontSize: 16 }}>{collapsedFolders.has(folder) ? '📁' : '📂'}</span>
                    <span className="folder-hdr-name">{folder.split(/[\\/]/).pop()}</span>
                    <span className="folder-hdr-n">{vids.length}</span>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-3)' }}>{collapsedFolders.has(folder) ? '▼' : '▲'}</span>
                  </div>
                  {!collapsedFolders.has(folder) && renderGrid(vids, offset)}
                </div>
              );
              offset += vids.length;
              return el;
            });
          })()
      }

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x} y={ctx.y}
          video={ctx.video}
          playlists={playlists}
          onClose={() => setCtx(null)}
          onOpen={() => dispatch({ type: 'PLAY_QUEUE', payload: { queue: [ctx.video], index: 0 } })}
          onAddToPlaylist={id => addToPlaylist(ctx.video.id, id)}
          onNewPlaylist={() => setPlModal({ videoId: ctx.video.id })}
        />
      )}

      {/* Playlist modal */}
      {plModal && (
        <PlaylistModal
          preVideoId={plModal.videoId}
          onClose={() => setPlModal(null)}
        />
      )}
    </main>
  );
}
