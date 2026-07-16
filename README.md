# Locked

Application de verrouillage d'examen pour écoles supérieures : un intervenant crée une
"room" avec une configuration d'examen, l'étudiant la rejoint depuis son PC personnel,
Excel (installation locale) est mis en plein écran et surveillé, et toute sortie de
l'application est détectée, chronométrée et remontée en temps réel à l'intervenant.

Ceci est un **squelette de MVP**, pas un produit fini. Voir "Limites connues" plus bas
avant tout déploiement réel.

## Architecture

```
backend/          Serveur Node.js/TypeScript : rooms, sessions, événements temps réel
                   (Socket.IO), dashboard intervenant (page statique servie par le backend)
windows-agent/     Application Windows (C#/.NET 8, WPF) installée sur le PC de l'étudiant :
                   lance Excel en plein écran, détecte la perte de focus, capture des
                   captures d'écran, communique avec le backend
```

Pas d'agent macOS pour l'instant (l'architecture est la même : app native + hooks
`NSWorkspace`/`CGEventTap` au lieu de `SetWinEventHook`/`SetWindowsHookEx`). Pas d'agent
iOS : cf. discussion — nécessite un parc de tablettes géré en MDM par l'école, hors
périmètre d'un développement logiciel classique.

## Faire tourner le backend

```bash
cd backend
npm install
npm run dev        # serveur sur http://localhost:4000
```

Dashboard intervenant : ouvrir `http://localhost:4000/dashboard.html`, entrer le code de
room (retourné par `POST /api/rooms`) pour voir les étudiants et le flux d'événements en
direct.

API principale :
- `POST /api/rooms` `{ teacherName, config }` → crée une room, retourne son `code`
- `POST /api/rooms/:code/join` `{ studentName }` → retourne `sessionId` + `config`
- WebSocket (Socket.IO) : `agent:join`, `agent:event`, `agent:heartbeat`,
  `dashboard:join`, `dashboard:exclude`, `agent:command`

## Faire tourner l'agent Windows

Nécessite Windows + [.NET 8 SDK](https://dotnet.microsoft.com/download) avec le workload
Desktop (WPF n'existe pas sous Linux/Mac, impossible à compiler ailleurs que sur
Windows — non testé/compilé dans cet environnement de développement pour cette raison) :

```powershell
cd windows-agent/LockedAgent
dotnet run
```

Renseigner l'adresse du serveur, le code de room, et un nom, puis "Rejoindre l'examen".
Excel se lance en plein écran ; sortir de la fenêtre affiche l'overlay rouge avec compte
à rebours configuré par l'intervenant.

## Ce qui est implémenté

- Création de room avec configuration (titre, durée du compte à rebours, fréquence et
  mode fixe/aléatoire des captures d'écran)
- Détection de perte de focus (`SetWinEventHook`) → overlay rouge plein écran avec
  compte à rebours → exclusion automatique si le délai expire
- Blocage best-effort de quelques raccourcis (Alt+Tab, touche Windows, Alt+F4) via un
  hook clavier bas niveau — **Ctrl+Alt+Del est volontairement non intercepté : Windows
  ne le délivre à aucun hook utilisateur, personne ne peut le bloquer**
- Capture d'écran à intervalle configurable (fixe ou aléatoire/"jitté") uploadée au
  backend
- Dashboard temps réel : présence des étudiants, journal d'événements, exclusion
  manuelle par l'intervenant

## Limites connues / prochaines étapes

- **Analyse IA des captures d'écran : pas encore implémentée.** Le endpoint d'upload
  existe (`POST /api/rooms/:code/sessions/:sessionId/screenshot`) et stocke déjà les
  fichiers ; il ne reste qu'à brancher un appel à un modèle de vision dessus.
- **Restriction des fonctionnalités Excel (Ouvrir un fichier, macros, etc.) : non
  implémentée.** Ça ne passe pas par cette codebase — ça se configure via les stratégies
  Cloud Policy Microsoft 365 côté compte scolaire de l'étudiant (voir discussion projet).
- **Persistance en mémoire uniquement** (`backend/src/store.ts`) : tout est perdu au
  redémarrage du serveur. À remplacer par une vraie base de données avant un usage réel.
- **Aucune authentification** sur les routes intervenant/étudiant : à ajouter avant tout
  déploiement au-delà d'un test interne.
- **Pas d'agent macOS.**
- **Conformité RGPD non traitée dans le code** (consentement/information, durée de
  conservation des captures, base légale) : c'est un prérequis produit/juridique, pas
  seulement technique, à valider avec chaque établissement avant lancement.
