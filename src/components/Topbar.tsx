import { useStore } from '../store';
import type { GridSize, SortMode } from '../types';

type Page = 'library' | 'playlists' | 'settings';

interface Props {
  page: Page;
  onPage: (p: Page) => void;
}

export default function Topbar({ page, onPage }: Props) {
  const { state, dispatch } = useStore();
  const { search, sortMode, viewMode, gridSize, muted } = state;

  return (
    <header className="topbar">
      {/* Logo + nav */}
      <span className="logo" style={{ cursor: 'pointer' }} onClick={() => onPage('library')}>WallStream</span>

      <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
        {(['library', 'playlists', 'settings'] as Page[]).map(p => (
          <button
            key={p}
            className={`tb-btn${page === p ? ' active' : ''}`}
            id={`nav-${p}`}
            onClick={() => onPage(p)}
            title={p === 'library' ? 'Library' : p === 'playlists' ? 'Playlists' : 'Settings'}
          >
            {p === 'library' ? '⊞' : p === 'playlists' ? '🎵' : '⚙'}
          </button>
        ))}
      </div>

      {/* Search — only on library */}
      {page === 'library' && (
        <div className="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx={11} cy={11} r={8}/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            id="search-input"
            placeholder="Search videos…"
            value={search}
            onChange={e => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
          />
        </div>
      )}

      {/* Right controls — only on library */}
      {page === 'library' && (
        <div className="topbar-right">

          {state.undockedVideos.length > 0 && (
            <button
              className="ico-btn"
              title="Close all undocked videos (Esc x2)"
              onClick={() => dispatch({ type: 'CLOSE_ALL_UNDOCKED' })}
              style={{ marginRight: 8, color: '#ff4d6a', borderColor: 'rgba(255, 77, 106, 0.3)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
        
          <button
            className={`ico-btn${state.wallMode ? ' active' : ''}`}
            title="Wall Mode (Q)"
            onClick={() => dispatch({ type: 'TOGGLE_WALL_MODE' })}
            style={{ marginRight: 8 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
          </button>

          <button
            className={`ico-btn${!muted ? ' active' : ''}`}
            title={muted ? 'Unmute hover video' : 'Mute hover video'}
            onClick={() => dispatch({ type: 'SET_MUTED', payload: !muted })}
            style={{ marginRight: 8 }}
          >
            {muted ? '🔇' : '🔊'}
          </button>

          {/* Sort */}
          <div className="seg" id="sort-seg">
            {(['date', 'name', 'size', 'folder'] as SortMode[]).map(s => (
              <button
                key={s}
                className={sortMode === s ? 'active' : ''}
                onClick={() => dispatch({ type: 'SET_SORT', payload: s })}
              >
                {s === 'date' ? 'Date' : s === 'name' ? 'Name' : s === 'size' ? 'Size' : 'Folder'}
              </button>
            ))}
          </div>

          {/* View mode */}
          <button
            className={`ico-btn${viewMode === 'folder-group' ? ' active' : ''}`}
            title="Group by folder"
            id="btn-view-folder"
            onClick={() => dispatch({ type: 'SET_VIEW', payload: viewMode === 'folder-group' ? 'grid' : 'folder-group' })}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}>
              <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/>
            </svg>
          </button>

          {/* Grid size */}
          <div className="seg" id="grid-seg">
            {(['sm', 'md', 'lg'] as const).map((s, i) => {
              const map: Record<string, GridSize> = { sm: 'small', md: 'medium', lg: 'large' };
              const label = ['S', 'M', 'L'][i];
              return (
                <button
                  key={s}
                  className={gridSize === map[s] ? 'active' : ''}
                  onClick={() => dispatch({ type: 'SET_GRID_SIZE', payload: map[s] })}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
