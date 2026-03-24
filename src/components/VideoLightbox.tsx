import { useRef, useEffect, useState, useCallback } from 'react';
import { videoStreamUrl } from '../api';
import { useStore } from '../store';
import PlaylistModal from './PlaylistModal';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sc = Math.floor(s % 60);
  return `${m}:${sc.toString().padStart(2, '0')}`;
}

export default function VideoLightbox() {
  const { state, dispatch } = useStore();
  const { playerQueue, playerIndex } = state;
  const cur = playerQueue[playerIndex];

  const vidRef = useRef<HTMLVideoElement>(null);
  const [showCtrl, setShowCtrl] = useState(true);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  const [vol, setVol] = useState(1);
  const hideTimer = useRef<number | null>(null);
  const lastMousePos = useRef({ x: -1, y: -1 });
  const [plModal, setPlModal] = useState<{ videoId?: string } | null>(null);

  const hasPrev = playerIndex > 0;
  const hasNext = playerIndex < playerQueue.length - 1;

  const prev = useCallback(() => dispatch({ type: 'PREV_VIDEO' }), [dispatch]);
  const next = useCallback(() => dispatch({ type: 'NEXT_VIDEO' }), [dispatch]);
  const onClose = useCallback(() => dispatch({ type: 'SET_PLAYER_MODE', payload: 'hidden' }), [dispatch]);
  const onMinimize = useCallback(() => dispatch({ type: 'SET_PLAYER_MODE', payload: 'mini' }), [dispatch]);

  const resetHide = useCallback(() => {
    setShowCtrl(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowCtrl(false), 3000);
  }, []);

  // Safe mouse move – blocks synthetic browser re-render events!
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (e.clientX === lastMousePos.current.x && e.clientY === lastMousePos.current.y) return;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    resetHide();
  }, [resetHide]);

  // Initial show
  useEffect(() => {
    resetHide();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [resetHide]);

  // Keybindings
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const v = vidRef.current;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') onMinimize();
      if (e.key === ' ' && v && cur?.type !== 'image') {
        e.preventDefault();
        v.paused ? v.play() : v.pause();
      }
      const seekAmount = e.shiftKey ? (state.config.seekLong || 30) : (state.config.seekShort || 5);
      const k = e.key.toLowerCase();
      if ((e.key === 'ArrowLeft' || k === 'a') && v && cur?.type !== 'image') {
        v.currentTime = Math.max(0, v.currentTime - seekAmount);
      }
      if ((e.key === 'ArrowRight' || k === 'd') && v && cur?.type !== 'image') {
        v.currentTime = Math.min(v.duration, v.currentTime + seekAmount);
      }
      if (e.key === '.' || k === 'w') next();
      if (e.key === ',' || k === 's') prev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [cur, dur, next, prev, onClose, onMinimize]);

  if (!cur) return null;

  return (
    <>
      <div className="lb" onMouseMove={handleMouseMove} style={{ cursor: showCtrl ? 'default' : 'none' }}>
        {cur.type === 'image' ? (
          <img
            key={cur.id}
            src={videoStreamUrl(cur.id)}
            style={{ width: '100vw', height: '100vh', objectFit: 'contain', display: 'block' }}
            alt={cur.name}
          />
        ) : (
          <video
            ref={vidRef}
            key={cur.id}
            src={videoStreamUrl(cur.id)}
            autoPlay
            onTimeUpdate={() => setTime(vidRef.current?.currentTime ?? 0)}
            onLoadedMetadata={() => setDur(vidRef.current?.duration ?? 0)}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onEnded={() => hasNext ? next() : onClose()}
            onClick={() => vidRef.current?.paused ? vidRef.current.play() : vidRef.current?.pause()}
            style={{ width: '100vw', height: '100vh', objectFit: 'contain', display: 'block' }}
          />
        )}

        <div className={`lb-topbar${showCtrl ? '' : ' hidden'}`} style={{ transition: 'opacity 0.3s', opacity: showCtrl ? 1 : 0 }}>
          <div className="lb-filename">{cur.name}</div>
        </div>

        <button className={`lb-close${showCtrl ? '' : ' hidden'}`} onClick={onClose} title="Close (Escape)" style={{ opacity: showCtrl ? 1 : 0, pointerEvents: showCtrl ? 'auto' : 'none' }}>✕</button>
        <button className={`lb-close${showCtrl ? '' : ' hidden'}`} onClick={onMinimize} title="Mini-player (Arrow Down)" style={{ right: 84, fontSize: 18, opacity: showCtrl ? 1 : 0, pointerEvents: showCtrl ? 'auto' : 'none' }}>⬇</button>

        {hasPrev && <button className="lb-side l" onClick={prev} style={{ opacity: showCtrl ? 1 : 0, pointerEvents: showCtrl ? 'auto' : 'none', transition: 'opacity 0.3s' }}>‹</button>}
        {hasNext && <button className="lb-side r" onClick={next} style={{ opacity: showCtrl ? 1 : 0, pointerEvents: showCtrl ? 'auto' : 'none', transition: 'opacity 0.3s' }}>›</button>}

        <div className={`lb-controls${showCtrl ? '' : ' hidden'}`}>
          {cur.type !== 'image' && (
            <div className="lb-progress">
              <input type="range" min={0} max={dur || 1} step={0.1} value={time} onChange={e => { if (vidRef.current) vidRef.current.currentTime = +e.target.value; }} />
              <span className="lb-time">{fmt(time)} / {fmt(dur)}</span>
            </div>
          )}

          <div className="lb-btns">
            {cur.type !== 'image' && (
              <>
                <button className="lb-btn" onClick={() => vidRef.current?.paused ? vidRef.current.play() : vidRef.current?.pause()}>
                  {paused ? '▶ Play' : '⏸ Pause'}
                </button>
                <input type="range" min={0} max={1} step={0.05} value={vol} style={{ width: 80, accentColor: 'var(--accent)', cursor: 'pointer' }} onChange={e => { const v = +e.target.value; setVol(v); if (vidRef.current) vidRef.current.volume = v; }} />
              </>
            )}

            <button className="lb-btn" onClick={() => setPlModal({ videoId: cur.id })}>＋ Playlist</button>

            <div className="lb-kb">
              {cur.type !== 'image' && (
                <>
                  <span className="kb"><span className="kk">←</span><span className="kk">→</span> / <span className="kk">A</span><span className="kk">D</span> ±{state.config.seekShort || 5}s</span>
                  <span className="kb"><span className="kk">Shift</span>+arrows ±{state.config.seekLong || 30}s</span>
                  <span className="kb"><span className="kk">Space</span> play</span>
                </>
              )}
              <span className="kb"><span className="kk">↓</span> mini-player</span>
              <span className="kb"><span className="kk">W</span><span className="kk">S</span> or <span className="kk">,</span><span className="kk">.</span> prev/next</span>
              <span className="kb"><span className="kk">Esc</span> close</span>
            </div>
          </div>
        </div>
      </div>
      
      {plModal && <PlaylistModal preVideoId={plModal.videoId} onClose={() => setPlModal(null)} />}
    </>
  );
}
