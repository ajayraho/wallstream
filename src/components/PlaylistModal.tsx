import { useState } from 'react';
import { useStore } from '../store';
import { v4 } from '../utils/uuid';
import type { Playlist } from '../types';

interface Props {
  preVideoId?: string;
  onClose: () => void;
}

export default function PlaylistModal({ preVideoId, onClose }: Props) {
  const { state, updatePlaylists } = useStore();
  const [name, setName] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    const pl: Playlist = {
      id: v4(),
      name: name.trim(),
      videoIds: preVideoId ? [preVideoId] : [],
      createdAt: Date.now(),
    };
    await updatePlaylists([...state.playlists, pl]);
    onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>🎵 New Playlist</h3>
        <input
          id="pl-name"
          autoFocus
          placeholder="Give it a name..."
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
        />
        {preVideoId && <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Selected video will be added</p>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={create} id="pl-create">Create</button>
        </div>
      </div>
    </div>
  );
}
