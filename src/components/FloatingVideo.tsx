import { useState } from 'react';
import { useStore } from '../store';
import { videoStreamUrl } from '../api';
import type { VideoFile } from '../types';

export default function FloatingVideo({ video, index }: { video: VideoFile; index: number }) {
  const { state, dispatch } = useStore();
  const [aspect, setAspect] = useState<number>(16/9);

  return (
    <div className="floating-vid" style={{ animationDelay: `${index * 50}ms`, width: `calc(280px * ${aspect})` }}>
      <div className="floating-hdr">
        <span className="floating-title">{video.name}</span>
        <button onClick={() => dispatch({ type: 'CLOSE_UNDOCKED', payload: video.id })}>✕</button>
      </div>
      <video 
        src={videoStreamUrl(video.id)} 
        controls 
        autoPlay={!state.config.pauseOnDock} 
        loop
        onLoadedMetadata={(e) => {
          const v = e.target as HTMLVideoElement;
          if (v.videoWidth && v.videoHeight) {
            setAspect(Math.max(0.5, Math.min(v.videoWidth / v.videoHeight, 3))); // Clamp aspect to prevent extreme panoramas
          }
        }}
      />
    </div>
  );
}
