import { useRef, useEffect, useState, useCallback } from 'react';
import type { VideoFile } from '../types';
import { videoStreamUrl } from '../api';
import { useStore } from '../store';

// How long a card must stay in view before we actually start loading it —
// avoids paying the real streaming/decoding cost for cards you scroll straight past.
const DWELL_MS = 220;

// Touch screens have no hover. Pressing a card and holding for this long starts a
// muted preview that keeps playing after the finger lifts. A normal tap still opens
// the lightbox as usual.
const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP_PX = 10; // finger drift allowed before it counts as a scroll/drag

// Only one touch preview plays at a time: starting a new one stops the previous.
let stopActiveTouchPreview: (() => void) | null = null;

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
  const [duration, setDuration] = useState(video.duration && video.duration > 0 ? video.duration : 1);
  const [aspect,  setAspect]    = useState<number>(video.width && video.height ? video.width / video.height : 16/9);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [srcLoaded, setSrcLoaded] = useState(false);
  const [touchPreview, setTouchPreview] = useState(false);
  const lastPointerType = useRef<string>('mouse');
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

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
  // Gated behind a short dwell timer: a card only actually starts streaming once
  // it's been visible continuously for DWELL_MS. Scrolling straight past a card
  // cancels the timer before it ever fires, so fast scrolling never touches the
  // archive at all — only cards you actually stop on (or hover, or Wall Mode) do.
  useEffect(() => {
    if (isHuge || video.type === 'image') return; // images handle their own src lazily in render

    if (visible && !srcLoaded) {
      const timer = setTimeout(() => {
        const vid = videoRef.current;
        if (!vid) return;
        vid.src = videoStreamUrl(video.id);
        vid.preload = 'metadata';
        setSrcLoaded(true);
      }, DWELL_MS);
      return () => clearTimeout(timer);
    }

    if (!visible && srcLoaded) {
      const vid = videoRef.current;
      if (vid) {
        vid.pause();
        vid.removeAttribute('src'); // critical for memory
        vid.load();
      }
      setSrcLoaded(false);
      setPlaying(false); // re-show placeholder
    }
  }, [visible, srcLoaded, video.id, video.type]);

  /* ── Play / Pause Logic (Wall Mode & Hover) ── */
  useEffect(() => {
    if (isHuge || video.type === 'image' || !srcLoaded) return;
    const vid = videoRef.current;
    if (!vid) return;

    const shouldPlay = state.wallMode ? visible : (hovered || touchPreview);
    
    if (shouldPlay) {
      vid.muted = state.muted || (touchPreview && !hovered); // touch previews are always muted
      vid.loop = true;
      vid.play().catch(() => {});
    } else {
      vid.pause();
      if (!state.wallMode) vid.currentTime = 0;
    }
  }, [visible, hovered, touchPreview, state.wallMode, state.muted, video.type, srcLoaded]);

  /* ── Touch preview lifecycle ── */
  // Stops when: another card starts previewing, the card scrolls out of view,
  // or the user touches anywhere outside this card. Lifting the finger does NOT stop it.
  useEffect(() => {
    if (!visible) setTouchPreview(false);
  }, [visible]);

  useEffect(() => {
    if (!touchPreview) return;
    const stop = () => setTouchPreview(false);
    if (stopActiveTouchPreview && stopActiveTouchPreview !== stop) stopActiveTouchPreview();
    stopActiveTouchPreview = stop;
    const onDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) stop();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      if (stopActiveTouchPreview === stop) stopActiveTouchPreview = null;
    };
  }, [touchPreview]);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    lastPointerType.current = e.pointerType;
    suppressClick.current = false;
    if (e.pointerType !== 'touch' || video.type !== 'video' || isHuge) return;
    clearPress();
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressStart.current = null;
      suppressClick.current = true; // the lift after a long press must not open the lightbox
      setTouchPreview(true);
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = pressStart.current;
    if (!s || pressTimer.current === null) return;
    if (Math.abs(e.clientX - s.x) > LONG_PRESS_SLOP_PX || Math.abs(e.clientY - s.y) > LONG_PRESS_SLOP_PX) clearPress();
  };

  useEffect(() => clearPress, []); // clear any pending timer on unmount

  /* ── Play on hover ── */
  const handleEnter = useCallback(() => {
    if (lastPointerType.current === 'touch') return; // ignore the fake hover phones emit after a tap
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
    if ((hovered || touchPreview) && videoRef.current) {
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        setTouchPreview(false);
        onOpen(video);
      }}
      onContextMenu={e => {
        e.preventDefault();
        // On touch, a long press means "preview" for videos, not "open the context menu"
        if (lastPointerType.current === 'touch' && video.type === 'video' && !isHuge) return;
        onCtx(e, video);
      }}
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

      {video.type === 'video' && duration > 1 && (
        <div className="vcard-duration">
          {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
        </div>
      )}

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
        <div className="vcard-slider-track" style={{ opacity: hovered || touchPreview ? 1 : 0 }}>
          <div className="vcard-slider-fill" style={{ width: `${(currentTime / duration) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
