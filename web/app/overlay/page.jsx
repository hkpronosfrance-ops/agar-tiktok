'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const CHANNEL_NAME = 'blob-battle';

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return { fill: `hsl(${hue} 78% 58%)`, glow: `hsl(${hue} 90% 65%)` };
}

function radiusFor(score) {
  return 34 + Math.sqrt(score) * 6.2;
}

export default function OverlayPage() {
  const canvasRef = useRef(null);
  const viewersRef = useRef({});
  const imageCache = useRef({});
  const roundEndsAtRef = useRef(0);

  const [leaderboard, setLeaderboard] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [podium, setPodium] = useState(null);

  function getImage(url) {
    if (!imageCache.current[url]) {
      const img = new Image();
      img.src = url;
      imageCache.current[url] = { el: img, ready: false };
      img.onload = () => { imageCache.current[url].ready = true; };
      img.onerror = () => { console.warn('Avatar failed to load:', url); };
    }
    return imageCache.current[url];
  }

  function ensureViewer(uniqueId, nickname, avatarUrl) {
    if (!viewersRef.current[uniqueId]) {
      const c = hashColor(uniqueId);
      viewersRef.current[uniqueId] = {
        nickname, avatarUrl, color: c.fill, glow: c.glow,
        score: 0, displayScore: 0,
        x: Math.random() * window.innerWidth * 0.7 + window.innerWidth * 0.15,
        y: Math.random() * window.innerHeight * 0.6 + window.innerHeight * 0.2,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        wobblePhase: Math.random() * Math.PI * 2,
        popups: [],
      };
    }
    return viewersRef.current[uniqueId];
  }

  // Abonnement Supabase Realtime
  useEffect(() => {
    const channel = supabase.channel(CHANNEL_NAME);

    channel.on('broadcast', { event: 'like' }, ({ payload }) => {
      const v = ensureViewer(payload.uniqueId, payload.nickname, payload.avatarUrl);
      v.score = payload.score;
      v.popups.push({ n: payload.delta, t: 0 });
    });

    channel.on('broadcast', { event: 'round_start' }, ({ payload }) => {
      viewersRef.current = {};
      roundEndsAtRef.current = payload.endsAt;
      setPodium(null);
    });

    channel.on('broadcast', { event: 'round_end' }, ({ payload }) => {
      setPodium(payload.ranking);
    });

    channel.on('broadcast', { event: 'state_sync' }, ({ payload }) => {
      roundEndsAtRef.current = payload.endsAt;
      Object.entries(payload.scores || {}).forEach(([uniqueId, v]) => {
        const viewer = ensureViewer(uniqueId, v.nickname, v.avatarUrl);
        viewer.score = v.score;
        if (v.avatarUrl && viewer.avatarUrl !== v.avatarUrl) viewer.avatarUrl = v.avatarUrl;
      });
    });

    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Timer + leaderboard (rafraîchi 3x/s, pas besoin de plus)
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.round((roundEndsAtRef.current - Date.now()) / 1000)));
      setLeaderboard(Object.values(viewersRef.current).sort((a, b) => b.score - a.score).slice(0, 5));
    }, 300);
    return () => clearInterval(id);
  }, []);

  // Boucle de rendu canvas (identique à la logique du prototype visuel)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf, last = performance.now();

    function resize() {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
    }
    resize();
    window.addEventListener('resize', resize);

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const sorted = Object.values(viewersRef.current).sort((a, b) => a.score - b.score);
      sorted.forEach((v) => {
        v.displayScore += (v.score - v.displayScore) * Math.min(dt * 4, 1);
        const r = radiusFor(v.displayScore);

        v.wobblePhase += dt * 1.6;
        if (Math.random() < 0.01) { v.vx += (Math.random() - 0.5) * 0.3; v.vy += (Math.random() - 0.5) * 0.3; }
        const speed = Math.hypot(v.vx, v.vy);
        if (speed > 0.5) { v.vx = v.vx / speed * 0.5; v.vy = v.vy / speed * 0.5; }
        v.x += v.vx * dt * 60; v.y += v.vy * dt * 60;
        const margin = r + 10;
        if (v.x < margin) { v.x = margin; v.vx *= -1; }
        if (v.x > window.innerWidth - margin) { v.x = window.innerWidth - margin; v.vx *= -1; }
        if (v.y < margin + 70) { v.y = margin + 70; v.vy *= -1; }
        if (v.y > window.innerHeight - margin - 40) { v.y = window.innerHeight - margin - 40; v.vy *= -1; }

        ctx.save();
        ctx.beginPath();
        const pts = 20;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const wob = Math.sin(a * 3 + v.wobblePhase) * r * 0.045;
          const rr = r + wob;
          const px = v.x + Math.cos(a) * rr, py = v.y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.shadowColor = v.glow; ctx.shadowBlur = 22;
        ctx.fillStyle = v.color; ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(v.x, v.y, r * 0.86, 0, Math.PI * 2);
        ctx.clip();
        const img = v.avatarUrl ? getImage(v.avatarUrl) : null;
        if (img && img.ready) {
          ctx.drawImage(img.el, v.x - r * 0.86, v.y - r * 0.86, r * 1.72, r * 1.72);
        } else {
          ctx.fillStyle = v.color;
          ctx.fillRect(v.x - r, v.y - r, r * 2, r * 2);
          ctx.fillStyle = '#fff';
          ctx.font = `700 ${Math.round(r * 0.6)}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((v.nickname || '?')[0].toUpperCase(), v.x, v.y);
        }
        ctx.restore();

        ctx.beginPath();
        ctx.arc(v.x, v.y, r * 0.86, 0, Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = v.color; ctx.stroke();

        ctx.font = "700 12px Inter, sans-serif";
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
        ctx.fillText('@' + v.nickname, v.x, v.y + r + 16);
        ctx.font = "700 11px 'JetBrains Mono', monospace";
        ctx.fillStyle = '#25F4EE';
        ctx.fillText(Math.round(v.displayScore) + ' pts', v.x, v.y + r + 30);
        ctx.shadowBlur = 0;

        v.popups = v.popups.filter((p) => p.t < 1);
        v.popups.forEach((p) => {
          p.t += dt * 0.9;
          ctx.save();
          ctx.globalAlpha = 1 - p.t;
          ctx.font = "800 15px 'Baloo 2', sans-serif";
          ctx.fillStyle = '#FE2C55';
          ctx.textAlign = 'center';
          ctx.fillText('+' + p.n, v.x, v.y - r - 10 - p.t * 22);
          ctx.restore();
        });
      });

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  function fmt(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: 'transparent', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 15 }}>
        <div style={{
          fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 52,
          background: 'linear-gradient(90deg,#25F4EE,#FE2C55)', WebkitBackgroundClip: 'text', color: 'transparent',
        }}>
          {fmt(remaining)}
        </div>
      </div>

      <div style={{
        position: 'absolute', top: 100, right: 20, width: 240, background: 'rgba(10,13,22,.55)',
        border: '1px solid rgba(255,255,255,.09)', borderRadius: 18, padding: 14, backdropFilter: 'blur(10px)', zIndex: 15,
      }}>
        <h3 style={{ fontFamily: "'Baloo 2', sans-serif", color: '#fff', margin: '0 0 10px', fontSize: 15 }}>👑 Classement live</h3>
        {leaderboard.map((v, i) => (
          <div key={v.nickname + i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 4px' }}>
            <span style={{ fontFamily: 'monospace', width: 16, color: i === 0 ? '#ffd23f' : '#6d7690', fontSize: 12 }}>{i + 1}</span>
            {v.avatarUrl
              ? <img src={v.avatarUrl} style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 26, height: 26, borderRadius: '50%', background: v.color }} />}
            <span style={{ flex: 1, color: '#e7eaf3', fontSize: 12.5, fontWeight: 600 }}>@{v.nickname}</span>
            <span style={{ color: '#25F4EE', fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{v.score}</span>
          </div>
        ))}
      </div>

      {podium && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,7,12,.72)', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 30, marginBottom: 20,
              background: 'linear-gradient(90deg,#25F4EE,#FE2C55)', WebkitBackgroundClip: 'text', color: 'transparent',
            }}>
              FIN DE MANCHE
            </div>
            {podium.map((p, i) => (
              <div key={p.uniqueId} style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 16, margin: '4px 0' }}>
                {i === 0 ? '👑 ' : `${i + 1}. `}@{p.nickname} — {p.score} pts
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
