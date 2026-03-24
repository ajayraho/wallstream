import { useState, useEffect } from 'react';
import { useStore } from '../store';
import type { VideoFile } from '../types';
import VideoCard from '../components/VideoCard';
import PlaylistModal from '../components/PlaylistModal';

export default function Playlists() {
  const { state, dispatch, updatePlaylists } = useStore();
  const { playlists, videos, gridSize } = state;

  const [openId,     setOpenId]    = useState<string | null>(null);
  const [plModal,    setPlModal]   = useState(false);
  const [cols,       setCols]      = useState(4);

  const openPl   = playlists.find(p => p.id === openId);
  const plVideos: VideoFile[] = openPl
    ? openPl.videoIds.map(id => videos.find(v => v.id === id)!).filter(Boolean)
    : [];

  const deletePlaylist = async (id: string) => {
    await updatePlaylists(playlists.filter(p => p.id !== id));
    if (openId === id) setOpenId(null);
  };

  const removeFromPlaylist = async (videoId: string) => {
    if (!openPl) return;
    const updated = playlists.map(p =>
      p.id === openPl.id
        ? { ...p, videoIds: p.videoIds.filter(id => id !== videoId) }
        : p
    );
    await updatePlaylists(updated);
  };

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

  /* ── Playlist list view ── */
  if (!openId) return (
    <main className="page">
      <div className="pg-hdr">
        <div>
          <div className="pg-title">Playlists</div>
          <div className="pg-sub">{playlists.length} playlist{playlists.length !== 1 ? 's' : ''}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setPlModal(true)} id="new-pl-btn">
          ＋ New Playlist
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🎵</div>
          <h3>No playlists yet</h3>
          <p>Right-click any video or use ＋ to create one.</p>
        </div>
      ) : (
        <div className="pl-grid">
          {playlists.map(pl => (
            <div key={pl.id} className="pl-card" onClick={() => setOpenId(pl.id)} id={`pl-${pl.id}`}>
              <div className="pl-icon">🎵</div>
              <div className="pl-name">{pl.name}</div>
              <div className="pl-meta">{pl.videoIds.length} video{pl.videoIds.length !== 1 ? 's' : ''}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }} onClick={e => e.stopPropagation()}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '5px 10px' }}
                  onClick={() => deletePlaylist(pl.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {plModal && <PlaylistModal onClose={() => setPlModal(false)} />}
    </main>
  );

  /* ── Playlist detail view ── */
  return (
    <main className="page">
      <div className="pg-hdr">
        <div>
          <button
            className="btn btn-ghost"
            style={{ marginBottom: 8, fontSize: 12 }}
            onClick={() => setOpenId(null)}
          >
            ← Back
          </button>
          <div className="pg-title">{openPl!.name}</div>
          <div className="pg-sub">{plVideos.length} video{plVideos.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {plVideos.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📭</div>
          <h3>Playlist is empty</h3>
          <p>Add videos via right-click or the ＋ button on a video card.</p>
        </div>
      ) : (
        <div className={`grid-masonry ${gridSize}`}>
          {Array.from({ length: cols }).map((_, cIdx) => (
            <div key={cIdx} className="grid-col">
              {plVideos.filter((_, i) => i % cols === cIdx).map(v => {
                const originalIdx = plVideos.findIndex(p => p.id === v.id);
                return (
                  <div key={v.id} style={{ position: 'relative' }}>
                    <VideoCard
                      video={v}
                      index={originalIdx}
                      onOpen={() => dispatch({ type: 'PLAY_QUEUE', payload: { queue: plVideos, index: originalIdx } })}
                      onCtx={() => {}}
                      onAddPlaylist={() => {}}
                    />
                    <button
                      style={{
                        position: 'absolute', top: 8, left: 8,
                        background: 'rgba(0,0,0,0.7)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 7,
                        color: '#ff4d6a',
                        padding: '3px 8px',
                        fontSize: 12,
                        cursor: 'pointer',
                        backdropFilter: 'blur(8px)',
                        zIndex: 30
                      }}
                      onClick={(e) => { e.stopPropagation(); removeFromPlaylist(v.id); }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
