'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [connected, setConnected] = useState(false);
  const durationRef = useRef(150);

  // Séquence de fin de manche : 'round' (podium de la manche) -> 'alltime'
  // (classement général par victoires) -> 'rules' (règles + compte à rebours) -> null
  const [phase, setPhase] = useState(null);
  const [roundRanking, setRoundRanking] = useState([]);
  const [alltime, setAlltime] = useState([]);
  const [rulesRemaining, setRulesRemaining] = useState(0);
  const rulesIntervalRef = useRef(null);

  const confetti = useMemo(() => {
    const colors = ['#25F4EE', '#FE2C55', '#ffd23f', '#ff7a3d'];
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.2 + Math.random() * 1.4,
      color: colors[i % colors.length],
      size: 6 + Math.random() * 6,
      rotate: Math.random() * 360,
    }));
  }, [roundRanking]);

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
      durationRef.current = payload.durationSeconds || durationRef.current;
      setPhase(null);
      if (rulesIntervalRef.current) clearInterval(rulesIntervalRef.current);
      setConnected(true);
    });

    channel.on('broadcast', { event: 'round_end' }, ({ payload }) => {
      setRoundRanking(payload.ranking);
      setPhase('round');
    });

    channel.on('broadcast', { event: 'alltime_leaderboard' }, ({ payload }) => {
      setAlltime(payload.leaderboard);
      setPhase('alltime');
    });

    channel.on('broadcast', { event: 'rules_intro' }, ({ payload }) => {
      setPhase('rules');
      setRulesRemaining(payload.seconds);
      if (rulesIntervalRef.current) clearInterval(rulesIntervalRef.current);
      rulesIntervalRef.current = setInterval(() => {
        setRulesRemaining((s) => Math.max(0, s - 1));
      }, 1000);
    });

    channel.on('broadcast', { event: 'state_sync' }, ({ payload }) => {
      roundEndsAtRef.current = payload.endsAt;
      durationRef.current = payload.durationSeconds || durationRef.current;
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
        const freshPop = v.popups.find((p) => p.t < 0.25);
        const popScale = freshPop ? 1 + (0.25 - freshPop.t) * 0.6 : 1;
        const r = radiusFor(v.displayScore) * popScale;

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

        // Reflet glossy (donne un aspect "bulle" plus vivant)
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(v.x - r * 0.32, v.y - r * 0.4, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.filter = 'blur(1px)';
        ctx.fill();
        ctx.restore();

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
      <style>{`
        @keyframes phaseIn {
          from { opacity: 0; transform: scale(.94); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes crownBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes confettiFall {
          from { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          to { transform: translateY(110vh) rotate(540deg); opacity: 0; }
        }
        @keyframes barPulse {
          0%, 100% { opacity: .9; }
          50% { opacity: .55; }
        }
      `}</style>

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
        <div style={{
          marginTop: 8, width: 'clamp(140px, 34vw, 220px)', height: 5, borderRadius: 999,
          background: 'rgba(255,255,255,.15)', overflow: 'hidden', marginInline: 'auto',
        }}>
          <div style={{
            height: '100%', borderRadius: 999,
            width: `${durationRef.current ? Math.min(100, (remaining / durationRef.current) * 100) : 0}%`,
            background: remaining <= 30 ? 'linear-gradient(90deg,#FE2C55,#ff7a3d)' : 'linear-gradient(90deg,#25F4EE,#FE2C55)',
            transition: 'width .3s linear',
          }} />
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
        {leaderboard.map((v, i) => {
          const maxScore = leaderboard[0]?.score || 1;
          const pct = Math.max(6, (v.score / maxScore) * 100);
          return (
            <div key={v.nickname + i} style={{ position: 'relative', padding: '6px 2px', overflow: 'hidden', borderRadius: 8 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 8,
                background: `linear-gradient(90deg, ${v.color}33, transparent)`,
                width: `${pct}%`, transition: 'width .4s ease',
              }} />
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
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
            </div>
          );
        })}
      </div>

      {phase === 'round' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,7,12,.78)', backdropFilter: 'blur(6px)', overflow: 'hidden',
          animation: 'phaseIn .35s ease-out',
        }}>
          {confetti.map((c) => (
            <div key={c.id} style={{
              position: 'absolute', top: 0, left: `${c.left}%`, width: c.size, height: c.size * 0.4,
              background: c.color, borderRadius: 2, transform: `rotate(${c.rotate}deg)`,
              animation: `confettiFall ${c.duration}s ease-in ${c.delay}s infinite`,
            }} />
          ))}
          <div style={{ textAlign: 'center', padding: '0 8%', position: 'relative' }}>
            <div style={{
              fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 'clamp(30px, 8vw, 44px)', marginBottom: '5vh',
              display: 'inline-block',
              backgroundImage: 'linear-gradient(90deg,#25F4EE,#FE2C55)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
            }}>
              FIN DE MANCHE
            </div>
            {roundRanking.map((p, i) => (
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
                <span>
                  {i === 0
                    ? <span style={{ display: 'inline-block', animation: 'crownBounce 1s ease-in-out infinite' }}>🥇</span>
                    : ['', '🥈', '🥉'][i]}
                  {' '}@{p.nickname} — {p.score} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'alltime' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,7,12,.78)', backdropFilter: 'blur(6px)', animation: 'phaseIn .35s ease-out',
        }}>
          <div style={{ textAlign: 'center', padding: '0 8%', width: '100%' }}>
            <div style={{
              fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 6.4vw, 36px)', marginBottom: '4vh',
              display: 'inline-block',
              backgroundImage: 'linear-gradient(90deg,#25F4EE,#FE2C55)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
            }}>
              🏆 CLASSEMENT GÉNÉRAL
            </div>
            <div style={{ maxWidth: 460, margin: '0 auto' }}>
              {alltime.length === 0 && (
                <div style={{ color: 'rgba(255,255,255,.6)', fontFamily: 'Inter, sans-serif', fontSize: 16 }}>
                  Sois le premier à gagner une manche !
                </div>
              )}
              {alltime.map((p, i) => (
                <div key={p.uniqueId} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 'clamp(16px, 4vw, 20px)',
                  fontWeight: i === 0 ? 700 : 500, margin: '10px 0', textAlign: 'left',
                }}>
                  <span style={{ width: 28, textAlign: 'center', flex: 'none' }}>{['🥇', '🥈', '🥉'][i] || (i + 1)}</span>
                  {p.avatarUrl
                    ? <img src={p.avatarUrl} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
                    : <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#444', flex: 'none' }} />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{p.nickname}</span>
                  <span style={{ color: '#25F4EE', fontFamily: 'monospace', flex: 'none' }}>
                    {p.winCount} 🏆
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === 'rules' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,7,12,.78)', backdropFilter: 'blur(6px)', animation: 'phaseIn .35s ease-out',
        }}>
          <div style={{ textAlign: 'center', padding: '0 9%' }}>
            <div style={{
              fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 6.4vw, 36px)', marginBottom: '4vh',
              display: 'inline-block',
              backgroundImage: 'linear-gradient(90deg,#25F4EE,#FE2C55)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
            }}>
              COMMENT JOUER ?
            </div>
            <div style={{
              color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 'clamp(16px, 4vw, 20px)',
              lineHeight: 1.7, marginBottom: '4vh',
            }}>
              ❤️ Chaque like = 1 point pour ton blob<br />
              📈 Plus tu likes, plus ton blob grossit<br />
              🏆 Le plus de points à la fin de la manche gagne
            </div>
            <div style={{
              fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 'clamp(40px, 10vw, 60px)',
              color: '#fff', animation: rulesRemaining <= 3 ? 'barPulse .6s ease-in-out infinite' : 'none',
            }}>
              {rulesRemaining}s
            </div>
            <div style={{
              fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 'clamp(13px, 2.8vw, 16px)',
              color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 6,
            }}>
              Prochaine manche
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
