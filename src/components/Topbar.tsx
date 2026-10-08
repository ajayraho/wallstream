import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { GridSize, SortMode } from '../types';
import SystemMonitor from './SystemMonitor';

type Page = 'library' | 'playlists' | 'settings';

interface Props {
  page: Page;
  onPage: (p: Page) => void;
}

export default function Topbar({ page, onPage }: Props) {
  const { state, dispatch } = useStore();
  const { search, sortMode, sortReverse, viewMode, gridSize, muted } = state;

  // Mobile-only drawer (CSS hides the burger + drawer behaviour on wide screens)
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const goPage = (p: Page) => {
    setMenuOpen(false);
    onPage(p);
  };

  return (
    <>
    {menuOpen && <div className="tb-backdrop" onClick={() => setMenuOpen(false)} />}
    <header className={`topbar${menuOpen ? ' menu-open' : ''}`}>
      {/* Logo + nav */}
      <span className="logo" style={{ cursor: 'pointer' }} onClick={() => goPage('library')}>WallStream</span>

      <div className="tb-nav">
        {(['library', 'playlists', 'settings'] as Page[]).map(p => (
          <button
            key={p}
            className={`tb-btn${page === p ? ' active' : ''}`}
            id={`nav-${p}`}
            onClick={() => goPage(p)}
            title={p === 'library' ? 'Library' : p === 'playlists' ? 'Playlists' : 'Settings'}
          >
            {p === 'library' ? '⊞' : p === 'playlists' ? '🎵' : '⚙'}
            <span className="tb-label">{p === 'library' ? 'Library' : p === 'playlists' ? 'Playlists' : 'Settings'}</span>
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

          {/* Reverse sort order */}
          <button
            className={`ico-btn${sortReverse ? ' active' : ''}`}
            title={sortReverse ? 'Sorted reversed — click to un-reverse' : 'Reverse sort order'}
            id="btn-sort-reverse"
            onClick={() => dispatch({ type: 'TOGGLE_SORT_REVERSE' })}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14} style={{ transform: sortReverse ? 'scaleY(-1)' : undefined, transition: 'transform var(--t)' }}>
              <path d="M3 7h11" />
              <path d="M3 12h7" />
              <path d="M3 17h4" />
              <path d="M17 4v16" />
              <path d="M13 8l4-4 4 4" />
            </svg>
          </button>

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

      {/* Always visible, regardless of page */}
      <div className="tb-mon" style={{ marginLeft: page === 'library' ? 0 : 'auto' }}>
        <SystemMonitor />
      </div>

      {/* Hamburger — mobile only (hidden by CSS on wide screens) */}
      <button
        className={`ico-btn tb-burger${menuOpen ? ' active' : ''}`}
        id="btn-menu"
        title={menuOpen ? 'Close menu' : 'Menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(o => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={16} height={16}>
          {menuOpen
            ? (<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>)
            : (<><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>)}
        </svg>
      </button>
    </header>
    </>
  );
}
