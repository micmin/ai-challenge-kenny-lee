# DriftDraw Playable Proof (Plan 3b) — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pre-implementation
**Scope:** Plan 3b — a minimal, single-device *playable proof* of the DriftDraw
game loop, deployed to Vercel on the existing Plan 3a backend. Not the full
multiplayer game.

## Summary

Plan 3b makes DriftDraw actually playable for the first time, as a **single-device
proof**: one human plays one seat, Claude auto-fills every other seat, and Imagen
draws every step. You caption your card each round, watch the AI take the other
seats ("Claude is captioning… Imagen is drawing…"), and at the end see every chain
revealed start-to-finish and pick your favourite. It is deployed to Vercel and
reuses the Plan 3a engine, AI wrappers, and Supabase backend essentially
unchanged. The goal is to demonstrate the AI-driven game loop end-to-end, not to
build real async multiplayer.

## Goals

- Prove the full loop — seed → caption → AI draw → drift → reveal → pick — works
  end-to-end with **real AI** (Imagen draws, Claude captions).
- Playable from a **live Vercel URL** in a single browser, no accounts or links.
- Make the AI's role **visible**: the human watches Claude and Imagen take the
  other seats, step by step.
- Reuse the Plan 3a backend (engine, AI wrappers, `GameService`, Supabase
  persistence + Storage) with minimal, additive changes.
- Stay fully testable offline with `MockAI` + the in-memory repository.

## Non-Goals (YAGNI / deferred)

- **No real multiplayer** — no join links, lobby, multiple humans, or accounts.
- **No notifications / deadline cron** — immediate AI fill replaces deadline-driven
  auto-fill; there is no waiting, so no timers.
- **No full voting engine** — the end-game "pick the funniest" stores a single
  chain choice, not multi-category tallies. The full voting engine stays deferred.
- **No real-time sockets** — a client-driven step loop is sufficient.
- **No polished visual design system** — clean and legible is enough for a proof.

## Locked Decisions

| Decision | Choice |
|---|---|
| Playable bar | Minimal single-device proof of the AI loop |
| Players | 1 human seat; Claude auto-fills all other seats; Imagen draws every step |
| Default size | 3 AI opponents (4 players total → ~4 human captions, a few-minute game) |
| Seed caption | Written by the human, with an optional Claude-suggested seed |
| Run location | Deployed to Vercel, reusing the Plan 3a Supabase backend |
| AI turn UX | "Watch the AI play" — stepped, one AI seat per request |
| End game | Animated reveal of all chains + lightweight "pick the funniest" |
| Persistence | Supabase (required on serverless; state survives between requests) |

## Screens & Flow

Six lightweight screens, single browser, human vs. AI:

1. **Start** — choose number of AI opponents (default 3); write an opening seed
   caption, with an optional *"✨ suggest one"* button calling Claude's
   `seedCaption`. Button starts the game.
2. **Your turn** — shows the single image currently handed to the human's seat plus
   a caption input. Enforced blindness: the human never sees the rest of that chain.
   Displays round N of total.
3. **AI is playing (stepped)** — after submit, a live progress feed as the AI takes
   the other seats: *"🤖 Claude captions Player 3's card ✓ / 🎨 Imagen draws ✓ / …"*
   Then the human's next image appears (or the game transitions to Reveal).
4. **Reveal** — each chain animates seed caption → image → caption → image → …
   final image. AI-auto-filled steps carry a subtle 🤖 marker.
5. **Pick the funniest** — the human chooses a favourite chain.
6. **Results** — shows the pick and a "Play again" button.

## Architecture

Reuse the Plan 3a stack; add a thin layer.

**Reused unchanged:** the engine (chains, parallel rotation, completion → reveal),
the AI wrappers (Imagen image, Claude caption + `seedCaption`), and the Plan 3a
backend (`GameService` load→run→save, `SupabaseGameRepository`,
`StorageImageService`, wiring).

**New backend components:**

1. **Step endpoint** — `POST /api/games/:id/step`. Performs **one pending AI
   action** and advances the chain: caption an open turn owned by a non-human (AI)
   seat (Claude), or render a pending image (Imagen) — including the initial seed
   images. Returns the updated player-scoped state plus a human-readable label
   (e.g. `"Player 3 — Claude captioned, Imagen drew"`). The client calls it
   repeatedly until it is the human's turn again or the game reaches `reveal`.
   One AI action per request keeps each call short and Vercel-timeout-safe, and
   *is* the stepped "watch the AI play" feed. When there is no pending AI action
   and no open human turn, the game has reached `reveal`.
   - This is the engine's existing auto-fill logic given a **manual trigger**
     instead of a deadline trigger — not new game logic.

2. **Solo-game setup** — a single entry point (e.g. `POST /api/games/solo`
   `{ seed, aiCount }`) that creates one human seat + N AI seats, seeds every
   chain, and starts the game — composing the existing create/join/start operations
   so the client does not have to. The **human's chain is seeded with their typed
   caption**; each **AI chain is seeded by Claude's `seedCaption`** (so every chain
   has a starting caption, since each seat seeds its own chain). The server marks
   AI seats so `step` knows which turns to auto-fill. (Player identity remains the
   `playerId` returned here, held client-side, per Plan 3a.)

3. **Lightweight vote** — `POST /api/games/:id/vote { chainId }` records the human's
   favourite chain; the results screen reads it. A single stored pick, not the full
   voting engine.

**New frontend:** the six screens as App Router client components, plus a small
client state machine: start → your-turn → step-loop (progress feed) → your-turn →
… → reveal → pick → results. State is refetched from `GET /api/games/:id` on load
so a refresh resumes on the correct screen.

## How AI seats are identified

At solo-game creation the server creates the human as the first seat and the
remaining seats as AI, flagged so the engine/step endpoint auto-fills them. The
`submitCaption` authorship guard from Plan 1 still rejects acting on another
seat's turn; the human only ever submits on their own open turn, and `step` only
fills AI-owned open turns.

## Data Flow

Human starts a solo game (seed + aiCount) → server seeds every chain (human's
typed caption on their chain, a Claude `seedCaption` on each AI chain) → client
loops `POST /step` to render the seed images (Imagen) and rotate chains until an
image lands on the human's seat → human sees that image and submits a caption
(image rendered, chain advanced) → client loops `POST /step`, each call running one
AI seat's turn until the human's next turn opens or all chains complete → when
every chain has N steps the game moves to `reveal` → the client shows the animated
reveal → human picks a favourite chain via `POST /vote` → results.

## Error Handling

- **AI failures** are already absorbed by the wrappers: a failed Imagen call
  inserts a placeholder image + flag; a failed Claude caption falls back to a safe
  caption. `step` inherits this — a hiccup never stalls the game.
- **A failed `/step` request** (network/timeout) → the client retries that step;
  Supabase state is consistent regardless, because each step is its own
  load→run→save with the optimistic-version check.
- **Refresh / resume** → state lives in Supabase, so reloading refetches the game
  and returns to the correct screen. Free from the Plan 3a backend.
- **Vercel** — set function `maxDuration` to 60s as a safety net, though each step
  is a single AI action and short by design.
- **Validation** — blank seed caption, blank human caption, or out-of-turn action
  → 400/409 before touching the engine (existing Plan 3a error mapping).

## Testing Strategy

- **Handler-level, offline:** with `MockAI` + the in-memory repository (the
  existing pattern), drive a full solo game: `solo` create → repeated `step` →
  `reveal` → `vote`, asserting player-scoped state and the AI-fill progression at
  each stage, including an AI-fill of every non-human seat and completion → reveal.
- **Vote endpoint:** assert a chain pick is stored and surfaced in results.
- **Regression:** the existing 108 tests stay green (engine/AI/3a untouched).
- **Frontend:** kept light; the real verification is playing the deployed game
  end-to-end from the Vercel URL.

## Dependencies (owner: Kenny; can run in parallel with the build)

1. **Get the missing AI key** — both Anthropic *and* Gemini keys are required for
   real image generation.
2. **Set up Vercel + Supabase** per `DEPLOYMENT.md` — the `games` table, the public
   `images` bucket with a `placeholder.png`, and the env vars. Gates the live
   deploy, not the offline build/test.

## What's Next

- **Implementation plan** — via the writing-plans skill, sequencing: backend (step
  endpoint, solo setup, vote) test-first → frontend screens + state machine →
  deploy verification on Vercel.
- **Deferred beyond the proof** — real multiplayer (links, lobby, multiple humans),
  notifications + deadline cron, and the full multi-category voting engine.
