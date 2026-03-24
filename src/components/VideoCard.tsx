import { useRef, useEffect, useState, useCallback } from 'react';
import type { VideoFile } from '../types';
import { videoStreamUrl } from '../api';
import { useStore } from '../store';

interface Props {
  video: VideoFile;
  index: number;
  onOpen: (video: VideoFile) => void;
  onCtx: (e: React.MouseEvent, video: VideoFile) => void;
  onAddPlaylist: (video: VideoFile) => void;
}

export default function VideoCard({ video, index, onOpen, onCtx, onAddPlaylist }: Props) {
  const { state, dispatch, updatePlaylists } = useStore(); // for muted state and playlists
  const cardRef  = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible]   = useState(false);
  const [playing, setPlaying]   = useState(false); // also acts as "loaded" for images
  const [hovered, setHovered]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1);
  const [aspect,  setAspect]    = useState<number>(16/9);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const srcLoaded = useRef(false);

  const isHuge = video.type === 'video' && video.size > 500 * 1024 * 1024;

  /* ── Strict load/unload observer ── */
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting);
      if (!e.isIntersecting) setDrawerOpen(false); // Add safety fallback to close drawer
    }, { rootMargin: '600px', threshold: 0 }); // unload strictly past 600px
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* ── Mount / Unmount src ── */
  useEffect(() => {
    if (isHuge || video.type === 'image') return; // images handle their own src lazily in render

    const vid = videoRef.current;
    if (!vid) return;

    if (visible && !srcLoaded.current) {
      vid.src = videoStreamUrl(video.id);
      vid.preload = 'metadata';
      srcLoaded.current = true;
    }

    if (!visible && srcLoaded.current) {
      vid.pause();
      vid.removeAttribute('src'); // critical for memory
      vid.load();
      srcLoaded.current = false;
      setPlaying(false); // re-show placeholder
    }
  }, [visible, video.id, video.type]);

  /* ── Play / Pause Logic (Wall Mode & Hover) ── */
  useEffect(() => {
    if (isHuge || video.type === 'image' || !srcLoaded.current) return;
    const vid = videoRef.current;
    if (!vid) return;

    const shouldPlay = state.wallMode ? visible : hovered;
    
    if (shouldPlay) {
      vid.muted = state.muted;
      vid.loop = true;
      vid.play().catch(() => {});
    } else {
      vid.pause();
      if (!state.wallMode) vid.currentTime = 0;
    }
  }, [visible, hovered, state.wallMode, state.muted, video.type]);

  /* ── Play on hover ── */
  const handleEnter = useCallback(() => {
    setHovered(true);
  }, []);

  const handleLeave = useCallback(() => {
    setHovered(false);
    setDrawerOpen(false); // close drawer on mouse leave
  }, []);

  const handleMetadata = () => {
    const vid = videoRef.current;
    if (vid && vid.videoWidth && vid.videoHeight && visible) {
      setAspect(vid.videoWidth / vid.videoHeight);
      setDuration(vid.duration || 1);
    }
  };

  const handleTimeUpdate = () => {
    if (hovered && videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Global hotkey attached only to the currently hovered card
  useEffect(() => {
    if (!hovered || video.type === 'image') return;
    const handleKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      
      const vid = videoRef.current;
      if (!vid) return;

      const seekAmount = e.shiftKey ? (state.config.seekLong || 30) : (state.config.seekShort || 5);
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || k === 'a') {
        e.preventDefault();
        vid.currentTime = Math.max(0, vid.currentTime - seekAmount);
        setCurrentTime(vid.currentTime);
      } else if (e.key === 'ArrowRight' || k === 'd') {
        e.preventDefault();
        vid.currentTime = Math.min(vid.duration || 1, vid.currentTime + seekAmount);
        setCurrentTime(vid.currentTime);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hovered, video.type]);

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img && img.naturalWidth && img.naturalHeight && visible) {
      setAspect(img.naturalWidth / img.naturalHeight);
    }
    setPlaying(true);
  };

  const handleQuickAdd = (e: React.MouseEvent, plId: string) => {
    e.stopPropagation();
    const p = state.playlists.find(x => x.id === plId);
    if (!p || p.videoIds.includes(video.id)) return;
    updatePlaylists(state.playlists.map(x => 
      x.id === plId ? { ...x, videoIds: [...x.videoIds, video.id] } : x
    ));
    setDrawerOpen(false);
  };

  const ext = video.name.split('.').pop()?.toUpperCase() ?? '';

  return (
    <div
      ref={cardRef}
      className="vcard"
      style={{ animationDelay: `${Math.min(index, 20) * 35}ms`, paddingBottom: `${(1 / aspect) * 100}%` }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={() => onOpen(video)}
      onContextMenu={e => { e.preventDefault(); onCtx(e, video); }}
      id={`vc-${video.id}`}
    >
      {video.type === 'image' ? (
        <img
          src={visible ? videoStreamUrl(video.id) : undefined}
          className={playing ? 'vis' : ''}
          onLoad={handleImgLoad}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: playing ? 1 : 0, transition: 'opacity 0.35s' }}
          alt={video.name}
        />
      ) : isHuge ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-1)', zIndex: 5, color: '#ff4d6a' }}>
           <svg viewBox="0 0 24 24" fill="currentColor" width="56" height="56" style={{ marginBottom: 12, cursor: 'pointer', opacity: 0.9 }} onClick={(e) => { e.stopPropagation(); onOpen(video); }}>
             <path d="M8 5v14l11-7z"/>
           </svg>
           <div style={{ fontSize: 13, fontWeight: 600, border: '1px solid rgba(255, 77, 106, 0.4)', padding: '4px 12px', borderRadius: 8, background: 'rgba(255, 77, 106, 0.1)' }}>
             ⚠️ Huge Video ({(video.size / (1024*1024)).toFixed(0)} MB)
           </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          className={playing ? 'vis' : ''}
          onLoadedData={() => setPlaying(true)}
          onLoadedMetadata={handleMetadata}
          onTimeUpdate={handleTimeUpdate}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          playsInline
        />
      )}

      {!isHuge && (
        <div className="vcard-ph" style={{ opacity: playing ? 0 : 1 }}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            {video.type === 'image' ? (
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            ) : (
              <path d="M8 5v14l11-7z"/>
            )}
          </svg>
        </div>
      )}

      <div className="vcard-badge">{ext}</div>

      <div className={`vcard-actions${drawerOpen ? ' force-show' : ''}`} onClick={e => e.stopPropagation()}>
        {drawerOpen && (
          <div className="vcard-playlist-strip">
            {state.playlists.map(pl => {
              const inConfig = pl.videoIds.includes(video.id);
              return (
                <button 
                  key={pl.id} 
                  className={`vcard-pl-btn${inConfig ? ' added' : ''}`}
                  onClick={(e) => handleQuickAdd(e, pl.id)}
                >
                  {pl.name}
                </button>
              );
            })}
            <button 
              className="vcard-pl-btn new"
              onClick={(e) => { e.stopPropagation(); setDrawerOpen(false); onAddPlaylist(video); }}
            >
              ＋ New
            </button>
          </div>
        )}
        
        {/* Undock */}
        <button 
          className="vcard-act-btn" 
          title="Undock Video" 
          onClick={e => { e.stopPropagation(); dispatch({ type: 'UNDOCK_VIDEO', payload: video }); }}
        >
          ⧉
        </button>

        <button 
          className="vcard-act-btn" 
          title={drawerOpen ? "Close playlists" : "Add to playlist"} 
          onClick={e => { e.stopPropagation(); setDrawerOpen(!drawerOpen); }}
        >
          {drawerOpen ? '›' : '＋'}
        </button>
      </div>

      {!isHuge && video.type === 'video' && (
        <div className="vcard-slider-track" style={{ opacity: hovered ? 1 : 0 }}>
          <div className="vcard-slider-fill" style={{ width: `${(currentTime / duration) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
