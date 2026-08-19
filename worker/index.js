import 'dotenv/config';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { getPreferredPictureFormat } from 'tiktok-live-connector/legacy';
import { createClient } from '@supabase/supabase-js';

const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME;
const ROUND_SECONDS = parseInt(process.env.ROUND_SECONDS || '300', 10);
const CHANNEL_NAME = 'blob-battle';

if (!TIKTOK_USERNAME) {
  console.error('❌ TIKTOK_USERNAME manquant dans .env');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const channel = supabase.channel(CHANNEL_NAME, { config: { broadcast: { self: false } } });

// Filet de sécurité : certains messages TikTok rares peuvent faire planter la
// librairie (bug connu). On log plutôt que de laisser le process crasher.
process.on('uncaughtException', (err) => {
  console.error('⚠️ Exception non gérée (le worker continue) :', err?.message || err);
});

let scores = {};             // uniqueId -> { nickname, avatarUrl, score }
const avatarCache = new Map(); // uniqueId -> URL publique Supabase Storage
let roundEndsAt = Date.now() + ROUND_SECONDS * 1000;
let roundLoop = null;

async function broadcast(event, payload) {
  await channel.send({ type: 'broadcast', event, payload });
}

// Télécharge la photo de profil TikTok une seule fois par viewer et la
// recache dans Supabase Storage pour éviter les soucis CORS côté overlay.
async function cacheAvatar(uniqueId, profilePictureUrl) {
  if (avatarCache.has(uniqueId)) return avatarCache.get(uniqueId);
  try {
    const res = await fetch(profilePictureUrl);
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `${uniqueId}.jpg`;
    await supabase.storage.from('avatars').upload(path, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    avatarCache.set(uniqueId, data.publicUrl);
    return data.publicUrl;
  } catch (err) {
    console.error(`⚠️ Cache avatar échoué pour ${uniqueId}:`, err.message);
    return null; // l'overlay affichera un fallback coloré avec l'initiale
  }
}

function startRoundLoop() {
  if (roundLoop) clearInterval(roundLoop);
  roundEndsAt = Date.now() + ROUND_SECONDS * 1000;
  broadcast('round_start', { endsAt: roundEndsAt, durationSeconds: ROUND_SECONDS });
  console.log(`🕐 Nouvelle manche démarrée (${ROUND_SECONDS}s)`);

  roundLoop = setInterval(async () => {
    if (Date.now() < roundEndsAt) return;

    const ranking = Object.entries(scores)
      .map(([uniqueId, v]) => ({ uniqueId, ...v }))
      .sort((a, b) => b.score - a.score);

    console.log('🏆 Fin de manche —', ranking.slice(0, 3).map(r => `${r.nickname}:${r.score}`).join(', '));
    await broadcast('round_end', { ranking: ranking.slice(0, 3) });

    scores = {};
    clearInterval(roundLoop);
    setTimeout(startRoundLoop, 4500); // laisse le podium s'afficher côté overlay
  }, 500);
}

// Republie l'état complet toutes les 3s : permet à un overlay qui se
// connecte/reconnecte en cours de manche (ex: refresh de la page OBS) de
// retrouver instantanément les scores en cours, sans attendre un nouveau like.
function startStateSync() {
  setInterval(() => {
    broadcast('state_sync', {
      scores,
      endsAt: roundEndsAt,
      durationSeconds: ROUND_SECONDS,
    });
  }, 3000);
}

async function main() {
  await channel.subscribe();
  console.log(`📡 Canal Supabase "${CHANNEL_NAME}" prêt`);

  const connection = new TikTokLiveConnection(TIKTOK_USERNAME, {
    signApiKey: process.env.EULER_SIGN_API_KEY || undefined,
  });

  connection.on(WebcastEvent.LIKE, async (data) => {
    const uniqueId = data.user?.displayId;
    if (!uniqueId) return; // messages sans displayId (rare), on ignore

    const likeCount = data.count || 1;

    if (!scores[uniqueId]) {
      const avatarSource = data.user?.avatarLarge || data.user?.avatarMedium || data.user?.avatarThumb;
      const pictureUrl = getPreferredPictureFormat(avatarSource?.urlList);
      if (!pictureUrl) {
        console.warn(`⚠️ Pas d'URL avatar trouvée pour ${uniqueId} (avatarLarge/Medium/Thumb absents sur ce message)`);
      }
      const avatarUrl = pictureUrl ? await cacheAvatar(uniqueId, pictureUrl) : null;
      scores[uniqueId] = { nickname: data.user?.nickname || uniqueId, avatarUrl, score: 0 };
    }
    scores[uniqueId].score += likeCount;

    broadcast('like', {
      uniqueId,
      nickname: scores[uniqueId].nickname,
      avatarUrl: scores[uniqueId].avatarUrl,
      score: scores[uniqueId].score,
      delta: likeCount,
    });
  });

  connection.on(ControlEvent.DISCONNECTED, () => {
    console.warn('⚠️ Live déconnecté, reconnexion dans 10s...');
    setTimeout(connect, 10000);
  });

  connection.on(ControlEvent.ERROR, (err) => {
    console.error('⚠️ Erreur de connexion (non fatale):', err?.message || err);
  });

  async function connect() {
    try {
      await connection.connect();
      console.log(`✅ Connecté au live de @${TIKTOK_USERNAME}`);
    } catch (err) {
      console.error('❌ Connexion échouée (le compte est-il bien EN LIVE ?), retry dans 10s:', err.message);
      setTimeout(connect, 10000);
    }
  }
  connect();

  startRoundLoop();
  startStateSync();
}

main();
