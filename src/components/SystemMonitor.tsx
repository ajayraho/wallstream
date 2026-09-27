import { useEffect, useRef, useState } from 'react';
import { fetchStats } from '../api';
import type { SystemStats } from '../types';

const HISTORY_LEN = 60; // 60 samples @ 1s = last minute
const POLL_MS = 1000;

function bandColor(pct: number): string {
  if (pct < 50) return '#3ddc84';   // green
  if (pct < 80) return '#f5c542';   // yellow
  return '#ff4d6a';                 // red
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

// Small dependency-free canvas sparkline, colored by the latest value's band.
function MiniGraph({ data, max, height = 44 }: { data: number[]; max: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 220;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) return;
    const latest = data[data.length - 1];
    const color = bandColor(latest);

    const stepX = width / Math.max(1, HISTORY_LEN - 1);
    const points = data.map((v, i) => {
      const x = width - (data.length - 1 - i) * stepX;
      const y = height - (Math.min(v, max) / max) * (height - 2) - 1;
      return [x, y] as const;
    });

    // filled area
    ctx.beginPath();
    ctx.moveTo(points[0][0], height);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(points[points.length - 1][0], height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, color + '05');
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [data, max, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} />;
}

function Row({ label, pct, sub, history }: { label: string; pct: number; sub: string; history: number[] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: bandColor(pct) }}>{pct.toFixed(1)}%</span>
      </div>
      <MiniGraph data={history} max={100} />
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export default function SystemMonitor() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [err, setErr] = useState(false);
  const historyRef = useRef({
    procCpu: [] as number[],
    sysCpu: [] as number[],
  });
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const s = await fetchStats();
        if (cancelled) return;
        setStats(s);
        setErr(false);
        const h = historyRef.current;
        h.procCpu = [...h.procCpu, s.process.cpuPercent].slice(-HISTORY_LEN);
        h.sysCpu = [...h.sysCpu, s.system.cpuPercent].slice(-HISTORY_LEN);
        forceTick(t => t + 1);
      } catch {
        if (!cancelled) setErr(true);
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        className={`ico-btn${open ? ' active' : ''}`}
        title="System monitor (CPU & RAM)"
        onClick={() => setOpen(o => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
          <polyline points="3 12 8 12 10 18 14 6 16 12 21 12" />
        </svg>
      </button>

      {open && (
        <div className="sysmon-panel">
          <div className="sysmon-hdr">
            <span>System Monitor</span>
            <button className="ico-btn" style={{ width: 24, height: 24 }} onClick={() => setOpen(false)} title="Close">✕</button>
          </div>

          {err && <div style={{ fontSize: 12, color: '#ff4d6a', padding: '8px 0' }}>Couldn't reach the server.</div>}

          {stats && (
            <>
              <Row
                label="WallStream process — CPU"
                pct={stats.process.cpuPercent}
                sub={`RSS ${fmtBytes(stats.process.rss)} · heap ${fmtBytes(stats.process.heapUsed)} / ${fmtBytes(stats.process.heapTotal)}`}
                history={historyRef.current.procCpu}
              />
              <Row
                label="System — CPU"
                pct={stats.system.cpuPercent}
                sub={`${stats.system.cores} cores · load avg ${stats.system.loadavg.map(l => l.toFixed(2)).join(' / ')}`}
                history={historyRef.current.sysCpu}
              />
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>System — RAM</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: bandColor((stats.system.usedMem / stats.system.totalMem) * 100) }}>
                    {((stats.system.usedMem / stats.system.totalMem) * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {fmtBytes(stats.system.usedMem)} / {fmtBytes(stats.system.totalMem)} used
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.5 }}>
                Process CPU is % of one core — it can pass 100% if decompression work spreads across threads. Updates every second while this panel is open.
              </div>
            </>
          )}

          {!stats && !err && <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 0' }}>Loading…</div>}
        </div>
      )}
    </div>
  );
}
