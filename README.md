# DriftDraw

An async multiplayer "telephone" drawing party game: players caption images, AI
redraws them, the picture drifts, and everyone votes on the funniest at the end.

## ▶️ Play

Once deployed (see `DEPLOYMENT.md`), play here: **<your-vercel-url>** (link added after first deploy).

## API (Plan 3a)

| Method + path | Body / query | Purpose |
|---|---|---|
| `POST /api/games` | `{ hostName, turnDeadlineMs }` | Create a game |
| `POST /api/games/:id/players` | `{ name }` | Join a game |
| `POST /api/games/:id/start` | — | Host starts the game |
| `GET /api/games/:id?playerId=…` | — | Player-scoped state + pending tasks |
| `POST /api/games/:id/captions` | `{ playerId, stepId, text }` | Submit a caption |

## Development

The backend logic is tested with Vitest (`npm test`). Builds and deploys run on
Vercel (clean internet); see `DEPLOYMENT.md`.
