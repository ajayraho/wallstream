export interface VideoFile {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  folder: string;
  folderName: string;
  size: number;
  mtime: number;
  type: 'video' | 'image';
}

export interface AppConfig {
  folders: string[];
  theme: 'dark' | 'light';
  includeImages?: boolean;
  pauseOnDock?: boolean;
  seekShort?: number;
  seekLong?: number;
}

export interface Playlist {
  id: string;
  name: string;
  videoIds: string[];
  createdAt: number;
}

export type SortMode = 'name' | 'date' | 'size' | 'folder';
export type ViewMode = 'grid' | 'folder-group';
export type GridSize = 'small' | 'medium' | 'large';
