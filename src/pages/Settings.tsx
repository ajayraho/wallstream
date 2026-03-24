import { useState } from 'react';
import { useStore } from '../store';

export default function Settings() {
  const { state, updateConfig, refresh } = useStore();
  const [newFolder, setNewFolder] = useState('');
  const [saving,    setSaving]    = useState(false);

  const addFolder = async () => {
    const f = newFolder.trim();
    if (!f || state.config.folders.includes(f)) return;
    setSaving(true);
    await updateConfig({ ...state.config, folders: [...state.config.folders, f] });
    setNewFolder('');
    setSaving(false);
  };

  const removeFolder = async (f: string) => {
    await updateConfig({ ...state.config, folders: state.config.folders.filter(x => x !== f) });
  };

  const toggleImages = async () => {
    await updateConfig({ ...state.config, includeImages: !state.config.includeImages });
  };

  return (
    <main className="page">
      <div className="settings-wrap">
        <div className="pg-hdr">
          <div>
            <div className="pg-title">Settings</div>
            <div className="pg-sub">Configure your video sources and preferences</div>
          </div>
          <button className="btn btn-ghost" onClick={refresh}>↺ Rescan</button>
        </div>

        {/* Video folders */}
        <div className="card">
          <div className="card-hdr">
            <span>📁</span>
            <div>
              <div>Video Folders</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400, marginTop: 2 }}>
                WallStream scans all subfolders recursively
              </div>
            </div>
          </div>
          <div className="card-body">
            {state.config.folders.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No folders added yet.</p>
            )}
            {state.config.folders.map(f => (
              <div key={f} className="folder-item">
                <span title={f}>{f}</span>
                <button onClick={() => removeFolder(f)} title="Remove">✕</button>
              </div>
            ))}
            <div className="add-row">
              <input
                id="folder-input"
                placeholder="e.g. C:\Users\You\Videos"
                value={newFolder}
                onChange={e => setNewFolder(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addFolder()}
              />
              <button className="btn btn-primary" onClick={addFolder} disabled={saving} id="add-folder-btn">
                {saving ? '…' : '＋ Add'}
              </button>
            </div>
          </div>
        </div>

        {/* General Prefs */}
        <div className="card">
          <div className="card-hdr"><span>⚙</span> General preferences</div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input 
                type="checkbox" 
                id="pauseDock"
                checked={!!state.config?.pauseOnDock}
                onChange={e => updateConfig({ ...state.config, pauseOnDock: e.target.checked })}
              />
              <label htmlFor="pauseDock" style={{ fontSize: 13, cursor: 'pointer' }}>Pause Undocked Videos by Default</label>
            </div>

            <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, color: 'var(--text-2)' }}>Short Seek (sec)</label>
                <input 
                  type="number" 
                  min="1" max="60"
                  value={state.config?.seekShort || 5}
                  onChange={e => updateConfig({ ...state.config, seekShort: parseInt(e.target.value) || 5 })}
                  style={{ width: 80, padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, color: 'var(--text-2)' }}>Long Seek (Shift + Arrow)</label>
                <input 
                  type="number" 
                  min="5" max="300"
                  value={state.config?.seekLong || 30}
                  onChange={e => updateConfig({ ...state.config, seekLong: parseInt(e.target.value) || 30 })}
                  style={{ width: 80, padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13 }}
                />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={!!state.config.includeImages}
                onChange={toggleImages}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
              />
              Show images in gallery (JPG, PNG, GIF, WebP, etc.)
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 26, marginTop: -4 }}>
              Toggle this on if you want WallStream to also discover and show images in your folders.
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="card">
          <div className="card-hdr">
            <span>📊</span> Library stats
          </div>
          <div className="card-body" style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Total media files', value: state.videos.length },
              { label: 'Folders watched', value: state.config.folders.length },
              { label: 'Playlists', value: state.playlists.length },
              { label: 'Total size', value: `${(state.videos.reduce((a, v) => a + v.size, 0) / 1024 / 1024 / 1024).toFixed(2)} GB` },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{s.label}</span>
                <span style={{ fontSize: 22, fontWeight: 700, background: 'var(--gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* About */}
        <div className="card">
          <div className="card-hdr"><span>ℹ</span> About</div>
          <div className="card-body" style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.7 }}>
            <p><strong style={{ color: 'var(--text)' }}>WallStream</strong> — Local video gallery with hover-play cards, lazy loading, playlists & more.</p>
            <p>Built by <strong style={{ color: 'var(--text)' }}>Ajit K.</strong></p>
          </div>
        </div>
      </div>
    </main>
  );
}
