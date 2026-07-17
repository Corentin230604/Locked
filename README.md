# Locked

Application de verrouillage d'examen pour écoles supérieures : un intervenant crée une
"room" avec une configuration d'examen, l'étudiant la rejoint depuis son PC personnel,
Excel (installation locale) est mis en plein écran et surveillé, et toute sortie de
l'application est détectée, chronométrée et remontée en temps réel à l'intervenant.

Ceci est un **squelette de MVP**, pas un produit fini. Voir "Limites connues" plus bas
avant tout déploiement réel.

## Architecture

```
render.yaml        Blueprint Render (référence backend/Dockerfile)
backend/           API Node.js/TypeScript (backend/api/*.ts), packagée en process
                   persistant (Dockerfile) — reste aussi compatible Vercel (fonctions
                   serverless) et Fly.io. Logique métier dans backend/src/lib/,
                   dashboard intervenant statique dans backend/public/.
supabase/          Schéma SQL (tables + politiques RLS + bucket de stockage)
windows-agent/     Application Windows (C#/.NET 8, WPF) installée sur le PC de l'étudiant
```

**Base de données + temps réel : Supabase.** Postgres pour les rooms/sessions/violations,
Storage pour les captures d'écran, Realtime (Postgres Changes) pour le flux live du
dashboard. **Hébergement de l'API : Render** (voir "Déployer sur Render" plus bas) —
palier gratuit sans carte bancaire, contrairement à Fly.io/Railway qui exigent
maintenant une carte et facturent au-delà d'un essai très court.

Le code a d'abord été écrit pour un hébergement serverless (Vercel), sans process
persistant possible — c'est pour ça qu'il n'y a **pas de Socket.IO** : le temps réel
passe par Supabase Realtime (le dashboard s'abonne directement aux tables
`sessions`/`violations`), et l'agent Windows détecte une exclusion déclenchée par le
prof en **interrogeant sa propre session toutes les 3 secondes** plutôt que de recevoir
un message poussé par le serveur. Render (comme Fly.io) fait tourner un process
persistant, donc rien n'empêcherait de réintroduire un vrai push serveur→agent plus
tard — mais l'architecture Supabase Realtime + polling fonctionne déjà et n'a pas été
changée en migrant d'hébergeur. Voir la discussion projet pour le raisonnement complet.

Pas d'agent macOS pour l'instant (l'architecture est la même : app native + hooks
`NSWorkspace`/`CGEventTap` au lieu de `SetWinEventHook`/`SetWindowsHookEx`). Pas d'agent
iOS : nécessite un parc de tablettes géré en MDM par l'école, hors périmètre d'un
développement logiciel classique.

## Mettre en place Supabase

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Dans l'éditeur SQL du projet, exécuter `supabase/schema.sql` (tables, politiques RLS,
   bucket de stockage `screenshots`).
3. Récupérer, dans les réglages du projet : l'URL du projet, la clé `service_role`
   (secrète, jamais exposée au navigateur ni à l'agent Windows) et la clé `anon`
   (publique, utilisée uniquement par le dashboard pour lire en temps réel).

## Faire tourner le backend en local

```bash
cd backend
npm install
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
export ANTHROPIC_API_KEY="..."   # optionnel — sans clé, l'analyse IA est juste désactivée
npm run dev        # serveur sur http://localhost:4000
```

Si le serveur échoue à joindre Supabase depuis un environnement derrière un proxy réseau
(ex. certains environnements Claude Code sur le web) alors que `curl` y arrive, c'est que
le `fetch` natif de Node ne respecte pas `HTTPS_PROXY` par défaut : ajouter
`export NODE_USE_ENV_PROXY=1` avant de lancer le serveur (Node ≥ 22.21). Ce n'est
qu'un détail de dev local — **Vercel n'a pas ce problème**, il gère son propre réseau
sortant.

**Espace intervenant** : ouvrir `http://localhost:4000/dashboard.html`. Trois champs de
connexion à renseigner une fois (mémorisés ensuite) : URL de l'API, URL Supabase, **clé
anon** (jamais la clé service_role !). Une fois connecté, deux actions possibles : créer
une room avec sa configuration (titre, compte à rebours, captures d'écran), ou rejoindre
une room déjà créée par son code — dans les deux cas ça amène au tableau de bord temps
réel (étudiants connectés, journal d'événements, exclusion manuelle). Design épuré
inspiré des interfaces Apple : typographie système, cartes arrondies, palette neutre.

API principale (REST, sans WebSocket) :
- `POST /api/rooms` `{ teacherName, config }` → crée une room, retourne son `code`
- `GET /api/rooms?code=XXX` → infos d'une room
- `POST /api/join` `{ code, studentName }` → retourne `sessionId` + `config`
- `GET /api/sessions?code=XXX` → snapshot des sessions d'une room (dashboard, chargement initial)
- `GET /api/session?sessionId=XXX` → statut d'une session (pollé par l'agent Windows)
- `POST /api/events` `{ sessionId, type, payload }` → relai d'un événement agent (focus perdu/retrouvé, exclusion, déconnexion)
- `POST /api/heartbeat` `{ sessionId }`
- `POST /api/screenshot` `{ sessionId, imageBase64 }` → upload + analyse IA (synchrone)
- `POST /api/exclude` `{ sessionId }` → exclusion manuelle par l'intervenant

## Déployer sur Render

Render fait tourner un process persistant (pas du serverless comme Vercel) : c'est
`backend/src/devServer.ts` (le même serveur Express que pour le dev local) qui tourne en
production, packagé via `backend/Dockerfile`. Palier gratuit sans carte bancaire — voir
"Limites connues" pour le compromis (mise en veille après inactivité).

**Via le dashboard Render (le plus simple) :**
1. New → Blueprint, connecter ce dépôt GitHub. Render détecte `render.yaml` à la racine
   automatiquement (il référence `backend/Dockerfile`).
2. Render demande les valeurs des variables marquées `sync: false` dans `render.yaml` :
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (optionnelle).
3. Déployer. Render construit l'image Docker et donne une URL `https://<nom>.onrender.com`.

**Via le CLI**, si le repo n'est pas connecté à Render :
```bash
render blueprint launch   # nécessite render-cli, lit render.yaml à la racine
```

Le service est sur le plan `free` (voir `render.yaml`) : il se met en veille après une
période d'inactivité et redémarre au prochain appel (30 à 60 secondes de délai à froid).
Pour ce cas d'usage (le prof lance la room quelques minutes avant l'examen), ce délai
tombe avant que les étudiants ne rejoignent — passer au plan payant si un démarrage
instantané est nécessaire.

**Non testé dans cet environnement de développement** (pas d'accès à un compte Render
ici) — vérifié en revanche : le serveur compilé (`npm run build && node
dist/src/devServer.js`, exactement ce que lance le `Dockerfile`) démarre correctement et
sert bien le dashboard statique en plus des routes API.

### Alternatives : Fly.io, Vercel

Le code reste compatible avec les deux si besoin de changer à nouveau :
- **Fly.io** : `backend/fly.toml` + `backend/Dockerfile` déjà présents (`fly launch --no-deploy && fly secrets set ... && fly deploy`) — mais carte bancaire obligatoire et facturation au-delà d'un essai très court (voir discussion projet).
- **Vercel** : `backend/api/*.ts` (un fichier = une fonction serverless) + `vercel deploy`. Mêmes variables d'environnement à configurer côté Vercel.

## Faire tourner l'agent Windows

Nécessite Windows + [.NET 8 SDK](https://dotnet.microsoft.com/download) avec le workload
Desktop (WPF n'existe pas sous Linux/Mac, impossible à compiler ailleurs que sur
Windows — non testé/compilé dans cet environnement de développement pour cette raison) :

```powershell
cd windows-agent/LockedAgent
dotnet run
```

C'est l'**espace étudiant** : renseigner l'adresse du serveur (Render ou localhost), le
code de room, et un nom, puis "Rejoindre l'examen". Excel se lance en plein écran ;
sortir de la fenêtre affiche l'overlay rouge avec compte à rebours configuré par
l'intervenant. L'agent ne détient aucune clé Supabase — il ne parle qu'à l'API
(`/api/...`), qui seule détient la clé `service_role`. Même palette visuelle que le
dashboard web (fenêtre de connexion redessinée), non vérifiable visuellement dans cet
environnement de développement faute de Windows.

## Ce qui est implémenté

- **Deux espaces distincts** : l'agent Windows (espace étudiant) et le dashboard web
  (espace intervenant, création de room + monitoring temps réel), avec un design
  cohérent entre les deux.
- Création de room avec configuration (titre, durée du compte à rebours, fréquence et
  mode fixe/aléatoire des captures d'écran)
- Détection de perte de focus (`SetWinEventHook`) → overlay rouge plein écran avec
  compte à rebours → exclusion automatique si le délai expire
- Blocage best-effort de quelques raccourcis (Alt+Tab, touche Windows, Alt+F4) via un
  hook clavier bas niveau — **Ctrl+Alt+Del est volontairement non intercepté : Windows
  ne le délivre à aucun hook utilisateur, personne ne peut le bloquer**
- Capture d'écran à intervalle configurable (fixe ou aléatoire/"jitté"), envoyée en
  base64 à l'API et stockée dans Supabase Storage
- **Analyse IA des captures** (`backend/src/screenshotAnalyzer.ts`) : chaque capture
  est analysée par Claude (vision) au moment de l'upload. Si une anomalie est détectée
  avec une confiance suffisante, un événement `ai_flag` est inséré dans `violations` —
  le dashboard le voit apparaître en temps réel comme **alerte à valider par
  l'intervenant**, pas d'exclusion automatique (l'IA peut se tromper, la perte de focus
  reste la seule règle dure). Sans `ANTHROPIC_API_KEY`, l'analyse est désactivée
  proprement (avertissement dans les logs, aucun crash).
- Dashboard temps réel (Supabase Realtime) : présence des étudiants, journal
  d'événements, exclusion manuelle par l'intervenant

## Limites connues / prochaines étapes

- **Testé contre un vrai projet Supabase** (room, join, événements, heartbeat, exclusion,
  upload de capture) — **pas encore contre un vrai déploiement Render**, à valider avant
  mise en production.
- **Mise en veille du plan gratuit Render** : si une room est créée juste après une
  longue période d'inactivité, le premier appel (création de room) subit un délai à
  froid de 30-60s avant que le serveur ne réponde — sans conséquence si le prof lance la
  room quelques minutes avant l'examen, à surveiller si l'usage devient plus imprévisible.
- **Exclusion par polling, pas push.** L'agent Windows découvre une exclusion décidée
  par le prof en interrogeant sa session toutes les 3 secondes — délai de quelques
  secondes acceptable pour ce cas d'usage, mais ce n'est pas instantané comme l'était
  Socket.IO.
- **Analyse IA : pas d'optimisation de coût.** Chaque capture déclenche un appel
  au modèle, sans filtre préalable (diff d'image) pour éviter d'analyser des
  captures quasi identiques — à ajouter avant un déploiement à grande échelle.
- **Restriction des fonctionnalités Excel (Ouvrir un fichier, macros, etc.) : non
  implémentée.** Ça ne passe pas par cette codebase — ça se configure via les stratégies
  Cloud Policy Microsoft 365 côté compte scolaire de l'étudiant (voir discussion projet).
- **Aucune authentification** sur les routes intervenant/étudiant : à ajouter avant tout
  déploiement au-delà d'un test interne. La politique RLS Supabase n'autorise en lecture
  que la clé anon (dashboard) ; toutes les écritures passent par la clé service_role
  côté serveur uniquement.
- **Pas d'agent macOS.**
- **Conformité RGPD non traitée dans le code** (consentement/information, durée de
  conservation des captures, base légale) : c'est un prérequis produit/juridique, pas
  seulement technique, à valider avec chaque établissement avant lancement.
