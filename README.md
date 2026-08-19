# Blob Battle — Overlay TikTok Live style agar.io

1 like TikTok = 1 point pour le blob du viewer. Manche de 5 min, classement final, personne ne "meurt".

## Architecture

```
worker/   → process Node.js persistant (Railway) : écoute les likes TikTok Live,
            cache les avatars dans Supabase Storage, diffuse les scores en temps réel
web/      → app Next.js (Vercel) : page /overlay à ajouter comme Browser Source dans OBS
```

Le pont entre les deux est un **channel Supabase Realtime (broadcast)** — pas d'écriture
en base à chaque like, donc pas de limite de débit à craindre côté Postgres.

## 1. Créer le projet Supabase

1. Nouveau projet sur supabase.com.
2. Storage → New bucket → nom `avatars` → **cocher "Public bucket"**.
3. Project Settings → API → noter `Project URL`, la clé `anon public` et la clé `service_role`.

## 2. Worker (Railway)

1. Pousser ce repo sur GitHub.
2. Railway → New Project → Deploy from GitHub → sélectionner le repo, **Root Directory = `worker`**.
3. Variables d'environnement (Railway → Variables), copier depuis `worker/.env.example` :
   - `TIKTOK_USERNAME` (le pseudo TikTok à écouter, sans @)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ROUND_SECONDS` (300 par défaut)
4. Start command : `npm start` (Railway le détecte automatiquement via `package.json`).

⚠️ Le worker ne se connecte que si le compte TikTok est **actuellement en live** — sinon il
retry toutes les 10s. Pour tester, lance un live TikTok avant de déployer/redémarrer le worker.

⚠️ `tiktok-live-connector` s'appuie sur l'API interne (non-officielle) de TikTok. Ça peut
casser si TikTok change son protocole — normal, il suffira de mettre à jour la dépendance.

## 3. Web / Overlay (Vercel)

1. Vercel → New Project → importer le repo, **Root Directory = `web`**.
2. Variables d'environnement, copier depuis `web/.env.local.example` :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (la clé **anon**, jamais la service_role côté front)
3. Déployer. L'overlay sera accessible sur `https://<ton-projet>.vercel.app/overlay`.

## 4. Brancher dans OBS

1. Ajouter une **Browser Source**.
2. URL : `https://<ton-projet>.vercel.app/overlay`
3. Fond transparent par défaut (pas besoin de chroma key).
4. Cocher "Refresh browser when scene becomes active" pour repartir propre à chaque activation.

## Notes

- Le worker est la seule source de vérité pour les scores (le front est purement
  affichage) — si tu rafraîchis la page overlay en cours de manche, elle repart à zéro
  visuellement jusqu'au prochain `round_start`. C'est acceptable pour un usage overlay,
  mais dis-le moi si tu veux que le worker renvoie l'état courant à la connexion.
- Historique des manches (table Postgres `game_rounds`) pas encore implémenté — facile à
  ajouter plus tard si tu veux un classement all-time / hall of fame.
