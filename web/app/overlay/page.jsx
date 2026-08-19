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
  return 42 + Math.sqrt(score) * 7.2;
}

export default function OverlayPage() {
  const canvasRef = useRef(null);
  const viewersRef = useRef({});
  const imageCache = useRef({});
  const roundEndsAtRef = useRef(0);

  const [leaderboard, setLeaderboard] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [podium, setPodium] = useState(null);
  const [connected, setConnected] = useState(false);

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
        x: window.innerWidth * 0.1 + Math.random() * window.innerWidth * 0.62,
        y: window.innerHeight * 0.22 + Math.random() * window.innerHeight * 0.5,
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
      setConnected(true);
    });

    channel.on('broadcast', { event: 'round_end' }, ({ payload }) => {
      setPodium(payload.ranking);
    });

    channel.on('broadcast', { event: 'state_sync' }, ({ payload }) => {
      roundEndsAtRef.current = payload.endsAt;
      setConnected(true);
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
        // Zones réservées à l'UI native TikTok Live : profil/viewers en haut,
        // like/cadeaux à droite, légende/commentaires en bas.
        const safeLeft = window.innerWidth * 0.05 + r;
        const safeRight = window.innerWidth * 0.82 - r;
        const safeTop = window.innerHeight * 0.16 + r;
        const safeBottom = window.innerHeight * 0.82 - r;
        if (v.x < safeLeft) { v.x = safeLeft; v.vx *= -1; }
        if (v.x > safeRight) { v.x = safeRight; v.vx *= -1; }
        if (v.y < safeTop) { v.y = safeTop; v.vy *= -1; }
        if (v.y > safeBottom) { v.y = safeBottom; v.vy *= -1; }

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

        ctx.font = "700 16px Inter, sans-serif";
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
        ctx.fillText('@' + v.nickname, v.x, v.y + r + 20);
        ctx.font = "700 14px 'JetBrains Mono', monospace";
        ctx.fillStyle = '#25F4EE';
        ctx.fillText(Math.round(v.displayScore) + ' pts', v.x, v.y + r + 38);
        ctx.shadowBlur = 0;

        v.popups = v.popups.filter((p) => p.t < 1);
        v.popups.forEach((p) => {
          p.t += dt * 0.9;
          ctx.save();
          ctx.globalAlpha = 1 - p.t;
          ctx.font = "800 19px 'Baloo 2', sans-serif";
          ctx.fillStyle = '#FE2C55';
          ctx.textAlign = 'center';
          ctx.fillText('+' + p.n, v.x, v.y - r - 12 - p.t * 26);
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

      {!connected && (
        <div style={{
          position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)',
          textAlign: 'center', zIndex: 12, padding: '10px 20px', borderRadius: 14,
          background: 'rgba(8,10,18,.42)', backdropFilter: 'blur(6px)',
        }}>
          <div style={{
            fontFamily: "'Baloo 2', sans-serif", fontWeight: 700, color: 'rgba(255,255,255,.75)',
            fontSize: 'clamp(17px, 4.2vw, 22px)',
          }}>
            En attente de connexion au live…
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', top: '5%', left: '50%', transform: 'translateX(-50%)', zIndex: 15 }}>
        <div style={{
          fontFamily: "'Baloo 2', sans-serif", fontWeight: 800,
          fontSize: 'clamp(50px, 10vw, 84px)', lineHeight: 1,
          padding: '8px 28px', borderRadius: 999,
          background: 'rgba(8,10,18,.42)', backdropFilter: 'blur(6px)',
          border: remaining <= 30 ? '1px solid rgba(254,44,85,.5)' : '1px solid rgba(255,255,255,.08)',
          boxShadow: remaining <= 30 ? '0 0 24px rgba(254,44,85,.35)' : 'none',
        }}>
          <span style={{
            display: 'inline-block',
            backgroundImage: remaining <= 30
              ? 'linear-gradient(90deg,#FE2C55,#ff7a3d)'
              : 'linear-gradient(90deg,#25F4EE,#FE2C55)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
          }}>
            {fmt(remaining)}
          </span>
        </div>
        <div style={{
          textAlign: 'center', marginTop: 8, fontFamily: 'Inter, sans-serif', fontWeight: 700,
          fontSize: 'clamp(13px, 2.8vw, 16px)', letterSpacing: '.06em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,.65)', textShadow: '0 1px 3px rgba(0,0,0,.6)',
        }}>
          1 like = 1 point
        </div>
      </div>

      <div style={{
        position: 'absolute', top: '13%', left: '4%',
        width: 'clamp(240px, 52vw, 340px)',
        background: 'rgba(10,13,22,.5)', border: '1px solid rgba(255,255,255,.09)',
        borderRadius: 18, padding: '16px 16px 10px', backdropFilter: 'blur(10px)', zIndex: 15,
      }}>
        <h3 style={{
          fontFamily: "'Baloo 2', sans-serif", color: '#fff', margin: '0 0 10px',
          fontSize: 'clamp(17px, 4vw, 21px)', display: 'flex', alignItems: 'center', gap: 7,
        }}>
          👑 Classement live
        </h3>
        {leaderboard.map((v, i) => (
          <div key={v.nickname + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px' }}>
            <span style={{ width: 22, textAlign: 'center', fontSize: 'clamp(16px, 3.6vw, 19px)' }}>
              {['🥇', '🥈', '🥉'][i] || <span style={{ color: '#6d7690', fontFamily: 'monospace', fontSize: 14 }}>{i + 1}</span>}
            </span>
            {v.avatarUrl
              ? <img src={v.avatarUrl} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
              : <div style={{ width: 32, height: 32, borderRadius: '50%', background: v.color, flex: 'none' }} />}
            <span style={{
              flex: 1, color: '#e7eaf3', fontSize: 'clamp(15px, 3.4vw, 18px)', fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              @{v.nickname}
            </span>
            <span style={{ color: '#25F4EE', fontFamily: 'monospace', fontSize: 'clamp(15px, 3.2vw, 18px)', fontWeight: 700 }}>
              {v.score}
            </span>
          </div>
        ))}
      </div>

      {podium && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,7,12,.78)', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ textAlign: 'center', padding: '0 8%' }}>
            <div style={{
              fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 'clamp(30px, 8vw, 44px)', marginBottom: '5vh',
              display: 'inline-block',
              backgroundImage: 'linear-gradient(90deg,#25F4EE,#FE2C55)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
            }}>
              FIN DE MANCHE
            </div>
            {podium.map((p, i) => (
              <div key={p.uniqueId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 'clamp(19px, 5vw, 25px)',
                fontWeight: i === 0 ? 700 : 500, margin: '14px 0',
              }}>
                {p.avatarUrl
                  ? <img src={p.avatarUrl} style={{
                      width: i === 0 ? 64 : 48, height: i === 0 ? 64 : 48, borderRadius: '50%', objectFit: 'cover',
                      border: `2px solid ${i === 0 ? '#ffd23f' : 'rgba(255,255,255,.4)'}`,
                    }} />
                  : null}
                <span>{['🥇', '🥈', '🥉'][i]} @{p.nickname} — {p.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
