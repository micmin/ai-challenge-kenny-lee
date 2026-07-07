# DriftDraw — Architecture

How DriftDraw is put together, why it's shaped this way, and the AI tooling and
workflow used to build it.

## Technology stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | One language across engine, API, and (future) UI |
| App framework | **Next.js 15** (App Router) | Single codebase for UI + API routes; first-class on Vercel |
| Runtime target | **Vercel** (serverless) | Free tier; holds secret API keys; auto-deploys from git |
| Persistence | **Supabase** — Postgres + Storage | Free Postgres for game state; Storage bucket for images |
| Image model | **Google Imagen** via `@google/genai` | The in-game "artist" |
| Text/vision model | **Anthropic Claude** (Haiku-class) via `@anthropic-ai/sdk` | Auto-fills missed turns from the image |
| Tests | **Vitest** | Fast, offline; 108 tests |
| CI | **GitLab CI** | Installs deps + typecheck + test on a clean-internet runner |

## Architecture overview

The system is a stack of thin layers, each depending only on the interface of the
one below it. The design principle throughout: **the game logic never touches
I/O.** Everything that talks to the outside world (AI providers, the database,
HTTP) sits behind an injected interface, so the engine can be tested exhaustively
offline for free.

```
HTTP request
  → Next.js route handler         src/app/api/**       parse + validate input
    → request handler (framework-agnostic)  src/server/http/handlers.ts
      → GameService.run(gameId, fn)          src/server/game-service.ts
          load {state, version} from Supabase          (GameRepository)
          hydrate a fresh GameStore + GameEngine        (src/engine)
          apply fn(engine)  — e.g. submitCaption / lazy processDeadlines
          persist state back w/ optimistic version check; retry on conflict
      ← handler shapes the JSON response + error code
```

### The layers

1. **Engine** (`src/engine/`) — pure, in-memory, framework-agnostic. Seeds chains,
   tracks whose turn it is, advances chains as captions arrive, checks deadlines,
   triggers auto-fill, and detects completion. It requests all AI work through an
   injected `AIServices` interface and mints IDs through an injected generator —
   it never imports a provider SDK or a database client.

2. **AI wrappers** (`src/ai/`) — two adapters that satisfy the engine's `AIServices`
   port: `GeminiImageService` (caption → image, with retry + placeholder
   fallback) and `ClaudeCaptionService` (image → caption for auto-fill, accepting
   both URL and base64 image sources). Each wraps an injected SDK client so tests
   run offline; a `createRealAIServices` factory builds the live versions.

3. **Backend library** (`src/server/`) — the orchestration and persistence seam:
   - `GameService` — owns the load → run → save loop and the optimistic-retry loop;
     builds a fresh engine per request with a UUID-based ID generator.
   - `GameRepository` — load/save the game row; an in-memory implementation for
     tests and a `SupabaseGameRepository` for production.
   - `StorageImageService` — decorates the real image service: generates the image,
     uploads the bytes to Supabase Storage, returns the public URL.
   - `wiring.ts` (`createGameService`) — the composition root that assembles the
     real stack from env vars; tests assemble a fake stack instead.

4. **HTTP layer** (`src/server/http/` + `src/app/api/`) — framework-agnostic request
   handlers (parse, validate, map errors) with the thin Next.js route handlers
   wrapping them. Splitting the two means the request logic is unit-tested without
   spinning up Next.js.

### Data model

- **Postgres `games` table:** `id` (text PK), `state` (jsonb — the whole
  serialized game), `version` (int — optimistic-concurrency counter),
  `created_at`, `updated_at`.
- **Storage `images` bucket** (public read): generated PNGs keyed by
  `<gameId>/<stepId>.png`; the game JSON holds the URL, not the bytes.

## Major design decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Engine isolation** | Engine has zero I/O; AI + persistence behind injected ports | Chain logic is the highest-value, trickiest code; keeping it pure means it's tested for free without spending money on image generation |
| **Whole-game JSON persistence** | Load full game → run in-memory → save the whole row | Dramatically simpler than a normalized relational schema; a single game is small and always loaded as a unit |
| **Optimistic concurrency** | `version` column, `save WHERE id=? AND version=?`, reload+retry | Two players can act at once on a serverless platform; this prevents lost updates without locks. 409 after bounded retries |
| **Images as URLs, not base64** | Upload to Storage; keep the URL in state | Keeps the game row (and every read) small; images are served directly by Supabase |
| **Lazy deadlines** | Process expiry on each read, no cron (in v1) | Removes a whole piece of infrastructure; a stalled game only matters when someone looks at it. A real cron is deferred to the deploy-hardening slice |
| **AI failures never block** | Placeholder image / safe fallback caption, flagged | A party game must always advance; an API hiccup shouldn't kill a game mid-chain |
| **Injected ID generator** | Default counter for engine tests; UUID generator in `GameService` | A fresh engine resuming a loaded game would otherwise re-mint existing IDs (`s1` collides). Backward-compatible: every original engine test still passes |
| **Framework-agnostic handlers** | HTTP logic separate from Next.js route files | The end-to-end game flow is testable offline without a running server |
| **Deploy off Vercel, verify in CI** | App runs on Vercel; correctness proven by GitLab CI | The dev laptop's corporate filter blocks `npm install`, so builds/tests must run on clean-internet machines (see RETROSPECTIVE) |

## AI tooling used

- **Claude Code** (Anthropic's agentic CLI) was the primary build tool — it wrote
  essentially all the code, tests, specs, and plans under direction.
- **Superpowers skills** — a structured skill library layered on Claude Code that
  enforces a `brainstorm → spec → plan → execute` discipline and test-driven
  development, rather than freeform code generation.
- **Two AI models are part of the product itself** (not just the build): Google
  Imagen as the in-game artist, and Claude vision as the missed-turn stand-in.

## Agent workflow

The project was built in slices, each following the same superpowers loop:

1. **Brainstorm** — an interactive skill that pins down intent, scope, and design
   before any code. Output: an approved design.
2. **Spec** — the design is written to a committed spec under
   `docs/superpowers/specs/` (both specs are the direct inputs to this repo's
   `SPEC.md`).
3. **Plan** — a detailed, ordered implementation plan is committed under
   `docs/superpowers/plans/` (one plan per slice).
4. **Execute** — the plan is carried out with test-driven development, frequently
   via **subagents** dispatched per independent task, then reviewed and merged.

The commit history mirrors this: each slice shows its plan committed first, then a
sequence of small `test:` / `feat:` / `fix:` commits. The four slices —
**core engine → AI wrappers → backend library → Next.js API** — were built and
merged in that order, with the engine deliberately left untouched as later slices
were added behind its ports.
