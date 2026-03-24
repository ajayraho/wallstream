import { useRef, useState } from 'react';
import { useStore } from '../store';
import { videoStreamUrl } from '../api';

export default function MiniPlayer() {
  const { state, dispatch } = useStore();
  const { playerQueue, playerIndex } = state;
  const cur = playerQueue[playerIndex];
  
  const vidRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);

  const hasNext = playerIndex < playerQueue.length - 1;
  const hasPrev = playerIndex > 0;

  if (!cur) return null;

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'SET_PLAYER_MODE', payload: 'hidden' });
  };
  
  const handleExpand = () => {
    dispatch({ type: 'SET_PLAYER_MODE', payload: 'fullscreen' });
  };

  const next = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'NEXT_VIDEO' });
  };

  const prev = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'PREV_VIDEO' });
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (vidRef.current) vidRef.current.paused ? vidRef.current.play() : vidRef.current.pause();
  };

  return (
    <div 
      className="mini-player" 
      onClick={handleExpand}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {cur.type === 'image' ? (
        <img src={videoStreamUrl(cur.id)} alt={cur.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <video 
          ref={vidRef}
          src={videoStreamUrl(cur.id)}
          autoPlay
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => hasNext ? dispatch({ type: 'NEXT_VIDEO' }) : dispatch({ type: 'SET_PLAYER_MODE', payload: 'hidden' })}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}

      <button className="mini-close" onClick={handleClose}>✕</button>

      <div className={`mini-controls${hover ? ' show' : ''}`}>
        <div style={{ padding: '8px 12px', fontSize: 11, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}>
          {cur.name}
        </div>
        
        <div className="mini-btns">
          {hasPrev && <button onClick={prev}>‹</button>}
          {cur.type !== 'image' && (
            <button onClick={togglePlay}>{paused ? '▶' : '⏸'}</button>
          )}
          {hasNext && <button onClick={next}>›</button>}
        </div>
      </div>
    </div>
  );
}
