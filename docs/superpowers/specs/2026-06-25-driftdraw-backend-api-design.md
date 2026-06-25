# DriftDraw Backend + API (Plan 3a) — Design Spec

**Date:** 2026-06-25
**Status:** Approved design, pre-implementation
**Scope:** Plan 3a of the DriftDraw build — Supabase persistence + Next.js API around the existing engine and AI wrappers. No UI.

## Summary

Plan 3a makes DriftDraw playable over HTTP and durable across requests. It wraps
the Plan 1 engine and Plan 2 AI wrappers in a Next.js (App Router) API, persists
each game as a single JSON row in Supabase, and stores generated images in
Supabase Storage (URLs, not base64). The engine and AI wrappers are reused
essentially unchanged — two small, backward-compatible touches are called out
below. No screens are built; correctness is proven through the HTTP layer and
tests.

This is the backend slice of the original "Plan 3 (Next.js API + web UI)." The UI
is split into a separate **Plan 3b**, brainstormed visually on its own.

## Goals

- Create, join, start, and play a game to the `reveal` phase entirely over HTTP.
- Game state durable in Supabase; survives server restarts and serverless cold starts.
- Generated images live in Supabase Storage; game rows stay small.
- Reuse the engine and AI wrappers with minimal, backward-compatible changes.
- Fully testable offline (injected fakes), with live Supabase wiring env-gated.

## Non-Goals (YAGNI / deferred)

- **No UI** — that is Plan 3b.
- **No voting / results** — the engine stops at `reveal` today; voting logic + its
  endpoints pair naturally with the reveal/voting UI and are deferred to Plan 3b.
- **No accounts/auth** — player identity is the `playerId` returned at join, held
  client-side (per the original game spec).
- **No scheduled deadline cron** — deadlines are processed lazily on read; a cron
  for stalled games is deferred to Plan 4.
- **No real-time push** — polling vs Supabase Realtime is a Plan 3b decision.

## Locked Decisions

| Decision | Choice |
|---|---|
| Persistence model | Whole-game JSON per request: load → run in-memory engine → save back |
| Concurrency | Optimistic: `version` column; save `WHERE id=? AND version=?`; on 0 rows, reload + retry |
| Image storage | Supabase Storage bucket; game JSON holds image **URLs**, not base64 |
| Deadlines | Processed lazily on every state read |
| ID generation | Inject a UUID-based id generator into the engine (default counter unchanged) |
| Voting/results, UI, real-time | Deferred to Plan 3b |

## Architecture

Next.js App Router. Thin **route handlers** delegate to a `GameService`
orchestration layer. Each call follows load → run → save.

```
HTTP request
  → route handler (parse + validate input)
    → GameService.run(gameId, fn)
        load {state, version} from Supabase (games table)
        hydrate a fresh in-memory GameStore + GameEngine (UUID id generator, injected AIServices)
        apply fn(engine)  // e.g. submitCaption, or lazy processDeadlines on read
        persist state back with optimistic version check; retry on conflict
    → route handler shapes the JSON response
```

### Two small, backward-compatible engine/AI touches

1. **Engine `idGenerator` injection.** Add an optional third constructor argument
   `new GameEngine(store, ai, idGenerator?)`. Default is the current per-instance
   counter, so every Plan 1 test passes unchanged. `GameService` injects a
   generator that returns globally unique IDs (e.g. `${prefix}_${randomUUID()}`),
   preventing collisions when a fresh engine resumes a loaded game.
   - *Why required:* the counter resets each request; resuming a game would re-mint
     existing IDs (`s1` collides with the loaded `s1`).
2. **`ClaudeCaptionService.captionForImage` accepts URLs.** Today it parses a
   base64 data URL. Add a branch: an `https://` URL is sent to Claude as a URL
   image source (`{type:'image', source:{type:'url', url}}`); a data URL keeps the
   existing base64 path. Both fall back to `FALLBACK_CAPTION` on error.

### New components (Plan 3a)

- **`StorageImageService`** (`implements ImageService`) — decorates an inner
  `ImageService` (the real `GeminiImageService`). It calls the inner service, then
  uploads the returned image bytes to a Supabase Storage bucket and returns the
  public URL. On the placeholder image, returns a static placeholder bucket URL.
  Injected with a minimal storage-uploader interface so it is testable with a fake.
- **`GameRepository`** — load/save the game row against Supabase with the
  optimistic-version protocol and retry loop. Depends on a minimal Supabase-client
  interface (fakeable).
- **`GameService`** — orchestrates load → run → save; owns the retry loop; builds a
  fresh engine per call with the injected UUID generator + injected `AIServices`.
- **Route handlers** — one per endpoint; parse/validate, call `GameService`, shape
  responses and error codes.
- **`createServer` wiring** — a factory that assembles `GameService` from a Supabase
  client, `AIServices`, and storage uploader. Production builds the real ones;
  tests inject fakes.

## Data Model (Supabase)

Table `games`:

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | The game id (UUID-based) |
| `state` | jsonb | The full serialized `Game` object |
| `version` | int | Optimistic-concurrency counter; bumped each save |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | set each save |

Storage bucket `images` (public read): generated PNGs, keyed by
`<gameId>/<stepId>.png`. The image step's `content` holds the public URL.

## API Endpoints

Player identity is the `playerId` from join, passed by the client. The
`submitCaption` authorship guard (Plan 1) already rejects acting on another
player's turn.

| Method + path | Body / query | Returns |
|---|---|---|
| `POST /api/games` | `{ hostName, turnDeadlineMs }` | `{ gameId, hostId }` |
| `POST /api/games/:id/players` | `{ name }` | `{ playerId }` |
| `POST /api/games/:id/start` | `{ }` (host implied) | `204` / updated state |
| `GET /api/games/:id?playerId=…` | — | `{ game, pendingTasks }`; runs lazy `processDeadlines` first |
| `POST /api/games/:id/captions` | `{ playerId, stepId, text }` | updated `{ game, pendingTasks }` |

Error mapping: unknown game → 404; bad input → 400; engine guard violations
(`'not your turn'`, `'game is not active'`, `'step is not an open caption'`) →
409/400 with the message; version-conflict exhaustion after retries → 409.

## Error Handling

- **Concurrency conflict:** retry the load → run → save loop up to a small bound
  (e.g. 3). If still conflicting, return 409 so the client can refetch and retry.
- **AI failures:** already absorbed inside the wrappers (placeholder image /
  fallback caption) — never surface as request errors.
- **Storage upload failure:** treated like an image failure — fall back to the
  placeholder URL so the chain still advances; logged, not fatal.
- **Supabase/network errors on load/save:** surface as 5xx; the client retries.
- **Validation:** missing/blank `name`, `text`, or `playerId` → 400 before touching the engine.

## Testing Strategy

- **`GameService` + repository:** unit-test load → run → save and the
  optimistic-retry loop with a **fake in-memory Supabase client** (a Map keyed by
  id, with a settable version) — including a simulated mid-flight version bump to
  prove the retry path.
- **`StorageImageService`:** fake uploader; assert it uploads the decoded bytes and
  returns the URL, and returns the placeholder URL on the placeholder image.
- **`ClaudeCaptionService` URL branch:** fake Claude client; assert an `https://`
  URL produces a URL image source and a data URL still produces a base64 block.
- **Route handlers (HTTP-level):** drive a full create → join → start → play →
  reveal game through the handlers with injected `MockAI` + fake store + fake
  storage; assert the persisted state and player-scoped responses. This is the
  end-to-end proof, offline.
- **Live wiring:** an env-gated check that hits a real Supabase project + bucket,
  skipped without credentials (mirrors Plan 2's live smoke test).

## Tech Stack

Next.js (App Router, route handlers) on the existing TypeScript/Vitest project;
`@supabase/supabase-js` for DB + Storage. Reuses `src/engine` and `src/ai`
unchanged except the two backward-compatible touches above. New code under
`src/server/` (orchestration, repository, storage, wiring) and `src/app/api/`
(route handlers).

## What's Next

- **Plan 3b — Web UI:** Lobby / Your-Turn / Reveal / Voting / Results screens
  against this API; add voting (engine logic + endpoints) and the real-time vs
  polling decision; brainstormed visually.
- **Plan 4 — Notifications + deploy:** browser push for "your turn," shareable
  links, deadline cron, Vercel deployment.
