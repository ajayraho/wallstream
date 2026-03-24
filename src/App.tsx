import { useState, useEffect, useRef } from 'react';
import { StoreProvider, useStore } from './store';
import Topbar from './components/Topbar';
import Library from './pages/Library';
import Playlists from './pages/Playlists';
import Settings from './pages/Settings';
import VideoLightbox from './components/VideoLightbox';
import MiniPlayer from './components/MiniPlayer';
import FloatingVideo from './components/FloatingVideo';

type Page = 'library' | 'playlists' | 'settings';

function AppInner() {
  const { state, dispatch } = useStore();
  const [page, setPage] = useState<Page>('library');
  const lastEscHit = useRef(0);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't toggle shorts if typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      
      if (e.key === 'Escape') {
        const now = Date.now();
        if (now - lastEscHit.current < 400) {
          dispatch({ type: 'CLOSE_ALL_UNDOCKED' });
          lastEscHit.current = 0; // reset
        } else {
          lastEscHit.current = now;
        }
      }

      if (e.key === 'm' || e.key === 'M') {
        dispatch({ type: 'SET_MUTED', payload: !state.muted });
      }
      const k = e.key.toLowerCase();

      if (k === 'q') {
        if (state.playerMode !== 'fullscreen') {
          dispatch({ type: 'TOGGLE_WALL_MODE' });
        }
      }

      // Allow W and S to double as layout scrolling when not in full-screen (WASD scheme)
      if (state.playerMode !== 'fullscreen') {
        if (k === 'w') window.scrollBy({ top: -60, behavior: 'smooth' });
        if (k === 's') window.scrollBy({ top: 60, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state.muted, dispatch]);

  return (
    <>
      {state.playerMode !== 'fullscreen' && <Topbar page={page} onPage={setPage} />}
      {page === 'library'   && <Library />}
      {page === 'playlists' && <Playlists />}
      {page === 'settings'  && <Settings />}

      {state.playerMode === 'fullscreen' && <VideoLightbox />}
      {state.playerMode === 'mini' && <MiniPlayer />}
      
      {state.undockedVideos.length > 0 && (
        <div className="undocked-row">
          {state.undockedVideos.map((v, i) => <FloatingVideo key={v.id} video={v} index={i} />)}
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppInner />
    </StoreProvider>
  );
}
