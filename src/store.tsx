import { createContext, useContext, useEffect, useReducer, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { AppConfig, GridSize, Playlist, SortMode, VideoFile, ViewMode } from './types';
import { fetchConfig, fetchPlaylists, fetchVideos, saveConfig, savePlaylists } from './api';

interface State {
  config: AppConfig;
  videos: VideoFile[];
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  search: string;
  sortMode: SortMode;
  viewMode: ViewMode;
  gridSize: GridSize;
  activePlaylistId: string | null;
  selectedVideoId: string | null;
  muted: boolean;
  playerQueue: VideoFile[];
  playerIndex: number;
  playerMode: 'hidden' | 'mini' | 'fullscreen';
  wallMode: boolean;
  undockedVideos: VideoFile[];
}

type Action =
  | { type: 'SET_CONFIG'; payload: AppConfig }
  | { type: 'SET_VIDEOS'; payload: VideoFile[] }
  | { type: 'SET_PLAYLISTS'; payload: Playlist[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_SORT'; payload: SortMode }
  | { type: 'SET_VIEW'; payload: ViewMode }
  | { type: 'SET_GRID_SIZE'; payload: GridSize }
  | { type: 'SET_ACTIVE_PLAYLIST'; payload: string | null }
  | { type: 'SET_SELECTED_VIDEO'; payload: string | null }
  | { type: 'SET_MUTED'; payload: boolean }
  | { type: 'PLAY_QUEUE'; payload: { queue: VideoFile[]; index: number } }
  | { type: 'SET_PLAYER_MODE'; payload: 'hidden' | 'mini' | 'fullscreen' }
  | { type: 'SET_PLAYER_INDEX'; payload: number }
  | { type: 'NEXT_VIDEO' }
  | { type: 'PREV_VIDEO' }
  | { type: 'TOGGLE_WALL_MODE' }
  | { type: 'UNDOCK_VIDEO'; payload: VideoFile }
  | { type: 'CLOSE_UNDOCKED'; payload: string }
  | { type: 'CLOSE_ALL_UNDOCKED' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CONFIG': return { ...state, config: action.payload };
    case 'SET_VIDEOS': return { ...state, videos: action.payload };
    case 'SET_PLAYLISTS': return { ...state, playlists: action.payload };
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_ERROR': return { ...state, error: action.payload };
    case 'SET_SEARCH': return { ...state, search: action.payload };
    case 'SET_SORT': return { ...state, sortMode: action.payload };
    case 'SET_VIEW': return { ...state, viewMode: action.payload };
    case 'SET_GRID_SIZE': return { ...state, gridSize: action.payload };
    case 'SET_ACTIVE_PLAYLIST': return { ...state, activePlaylistId: action.payload };
    case 'SET_SELECTED_VIDEO': return { ...state, selectedVideoId: action.payload };
    case 'SET_MUTED':         return { ...state, muted: action.payload };
    case 'PLAY_QUEUE':        return { ...state, playerQueue: action.payload.queue, playerIndex: action.payload.index, playerMode: 'fullscreen', wallMode: false };
    case 'SET_PLAYER_MODE':   return { ...state, playerMode: action.payload };
    case 'SET_PLAYER_INDEX':  return { ...state, playerIndex: action.payload };
    case 'NEXT_VIDEO':        return state.playerIndex < state.playerQueue.length - 1 ? { ...state, playerIndex: state.playerIndex + 1 } : state;
    case 'PREV_VIDEO':        return state.playerIndex > 0 ? { ...state, playerIndex: state.playerIndex - 1 } : state;
    case 'TOGGLE_WALL_MODE':  return { ...state, wallMode: !state.wallMode };
    case 'UNDOCK_VIDEO':      return state.undockedVideos.find(v => v.id === action.payload.id) ? state : { ...state, undockedVideos: [...state.undockedVideos, action.payload] };
    case 'CLOSE_UNDOCKED':    return { ...state, undockedVideos: state.undockedVideos.filter(v => v.id !== action.payload) };
    case 'CLOSE_ALL_UNDOCKED':return { ...state, undockedVideos: [] };
    default: return state;
  }
}

const initial: State = {
  config: { folders: [], theme: 'dark' },
  videos: [],
  playlists: [],
  loading: false,
  error: null,
  search: '',
  sortMode: 'date',
  viewMode: 'grid',
  gridSize: 'medium',
  activePlaylistId: null,
  selectedVideoId: null,
  muted: true,
  playerQueue: [],
  playerIndex: 0,
  playerMode: 'hidden',
  wallMode: false,
  undockedVideos: [],
};

interface StoreContextType {
  state: State;
  dispatch: React.Dispatch<Action>;
  refresh: () => Promise<void>;
  updateConfig: (cfg: AppConfig) => Promise<void>;
  updatePlaylists: (pl: Playlist[]) => Promise<void>;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  const refresh = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const [cfg, videos, playlists] = await Promise.all([
        fetchConfig(),
        fetchVideos(),
        fetchPlaylists(),
      ]);
      dispatch({ type: 'SET_CONFIG', payload: cfg });
      dispatch({ type: 'SET_VIDEOS', payload: videos });
      dispatch({ type: 'SET_PLAYLISTS', payload: playlists });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: 'Could not connect to WallStream server. Is it running?' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  const updateConfig = useCallback(async (cfg: AppConfig) => {
    dispatch({ type: 'SET_CONFIG', payload: cfg });
    await saveConfig(cfg);
    await refresh();
  }, [refresh]);

  const updatePlaylists = useCallback(async (pl: Playlist[]) => {
    dispatch({ type: 'SET_PLAYLISTS', payload: pl });
    await savePlaylists(pl);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <StoreContext.Provider value={{ state, dispatch, refresh, updateConfig, updatePlaylists }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
