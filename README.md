# Locked

Application de verrouillage d'examen pour écoles supérieures : un intervenant crée une
"room" avec une configuration d'examen, l'étudiant la rejoint depuis son PC personnel,
Excel (installation locale) est mis en plein écran et surveillé, et toute sortie de
l'application est détectée, chronométrée et remontée en temps réel à l'intervenant.

Ceci est un **squelette de MVP**, pas un produit fini. Voir "Limites connues" plus bas
avant tout déploiement réel.

## Architecture

```
backend/          Fonctions serverless Node.js/TypeScript (déployables sur Vercel),
                   logique métier dans backend/src/lib/, dashboard intervenant statique
supabase/          Schéma SQL (tables + politiques RLS + bucket de stockage)
windows-agent/     Application Windows (C#/.NET 8, WPF) installée sur le PC de l'étudiant
```

**Base de données + temps réel : Supabase.** Postgres pour les rooms/sessions/violations,
Storage pour les captures d'écran, Realtime (Postgres Changes) pour le flux live du
dashboard. **Hébergement des routes API : Vercel.** Ce choix a une conséquence
architecturale importante : Vercel est serverless (pas de process persistant), donc
**pas de Socket.IO** — le temps réel passe par Supabase Realtime (le dashboard s'abonne
directement aux tables `sessions`/`violations`), et l'agent Windows détecte une
exclusion déclenchée par le prof en **interrogeant sa propre session toutes les 3
secondes** plutôt que de recevoir un message poussé par le serveur (il n'y a plus de
canal serveur → agent une fois Socket.IO retiré). Voir la discussion projet pour le
raisonnement complet.

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

Dashboard intervenant : ouvrir `http://localhost:4000/dashboard.html`, renseigner l'URL
de l'API, l'URL Supabase, la **clé anon** (pas la clé service_role !) et le code de room.

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

## Déployer sur Vercel

```bash
cd backend
vercel deploy
```

Configurer dans le projet Vercel les variables d'environnement `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. **Non testé dans cet environnement de
développement** (pas d'accès à un compte Vercel ni à un vrai projet Supabase ici) — la
structure du code suit les conventions Vercel (un fichier = une fonction sous `api/`),
mais un premier déploiement réel doit être vérifié avant mise en production. Le fichier
`vercel.json` augmente le timeout de `api/screenshot.ts` à 30s (l'appel au modèle de
vision peut prendre quelques secondes) — à revoir si le plan Vercel utilisé plafonne
plus bas.

## Faire tourner l'agent Windows

Nécessite Windows + [.NET 8 SDK](https://dotnet.microsoft.com/download) avec le workload
Desktop (WPF n'existe pas sous Linux/Mac, impossible à compiler ailleurs que sur
Windows — non testé/compilé dans cet environnement de développement pour cette raison) :

```powershell
cd windows-agent/LockedAgent
dotnet run
```

Renseigner l'adresse du serveur (Vercel ou localhost), le code de room, et un nom, puis
"Rejoindre l'examen". Excel se lance en plein écran ; sortir de la fenêtre affiche
l'overlay rouge avec compte à rebours configuré par l'intervenant. L'agent ne détient
aucune clé Supabase — il ne parle qu'à l'API (`/api/...`), qui seule détient la clé
`service_role`.

## Ce qui est implémenté

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
  upload de capture) — **pas encore contre un vrai déploiement Vercel**, à valider avant
  mise en production.
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
