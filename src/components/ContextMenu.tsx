import { useEffect, useRef } from 'react';
import type { VideoFile, Playlist } from '../types';

interface Props {
  x: number; y: number;
  video: VideoFile;
  playlists: Playlist[];
  onClose: () => void;
  onOpen: () => void;
  onAddToPlaylist: (id: string) => void;
  onNewPlaylist: () => void;
}

export default function ContextMenu({ x, y, video, playlists, onClose, onOpen, onAddToPlaylist, onNewPlaylist }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [onClose]);

  const sx = Math.min(x, window.innerWidth  - 210);
  const sy = Math.min(y, window.innerHeight - 280);

  return (
    <div ref={ref} className="ctx" style={{ left: sx, top: sy }}>
      <button className="ctx-item" onClick={() => { onOpen(); onClose(); }}>▶ Open</button>
      <div className="ctx-divider" />
      <button className="ctx-item" onClick={() => { onNewPlaylist(); onClose(); }}>🎵 New playlist with this</button>
      {playlists.length > 0 && (
        <>
          <div className="ctx-label">Add to playlist</div>
          {playlists.map(p => (
            <button key={p.id} className="ctx-item" onClick={() => { onAddToPlaylist(p.id); onClose(); }}>
              📋 {p.name}
            </button>
          ))}
        </>
      )}
      <div className="ctx-divider" />
      <button className="ctx-item" onClick={() => { navigator.clipboard.writeText(video.path); onClose(); }}>
        📋 Copy path
      </button>
    </div>
  );
}
