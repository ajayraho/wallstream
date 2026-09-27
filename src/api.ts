import type { AppConfig, Playlist, VideoFile, SystemStats } from './types';

const BASE = '/api';

export async function fetchConfig(): Promise<AppConfig> {
  const r = await fetch(`${BASE}/config`);
  return r.json();
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await fetch(`${BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function fetchVideos(): Promise<VideoFile[]> {
  const r = await fetch(`${BASE}/videos`);
  return r.json();
}

export function videoStreamUrl(id: string): string {
  return `${BASE}/video/${id}`;
}

export async function fetchPlaylists(): Promise<Playlist[]> {
  const r = await fetch(`${BASE}/playlists`);
  return r.json();
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  await fetch(`${BASE}/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(playlists),
  });
}

export async function fetchStats(): Promise<SystemStats> {
  const r = await fetch(`${BASE}/stats`);
  return r.json();
}
