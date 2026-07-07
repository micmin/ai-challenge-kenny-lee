# DriftDraw — Specification

This is the product specification for DriftDraw: the game rules, what is and isn't
in scope, the functional requirements, and the acceptance criteria used to judge
"done." It consolidates the two design specs under `docs/superpowers/specs/` into
a single reviewer-facing document.

## 1. Game rules

DriftDraw is a turn-based, asynchronous "telephone" party game. Humans only ever
**caption**; the AI always **draws**.

### Setup

- A **host** creates a game and gets a shareable invite link.
- Players open the link, choose a display name, and join the lobby. No accounts.
- The host sets a **per-turn deadline** (e.g. 1h / 8h / 24h) and starts the game.
- Sweet spot is 3–8 players; 2 is the minimum.

### The chain

- Each player starts **one chain** with a short seed caption (e.g. "a cat doing
  taxes").
- Chains rotate around the group. Each step is:
  1. The AI (Imagen) renders the current caption into an image.
  2. The chain is handed to the next player, who sees **only that image**.
  3. That player writes a new caption describing what they see.
- Each chain passes through **every player exactly once**, so with N players a
  chain has N caption steps. All N chains run in parallel — every round, each
  player has exactly one caption to write (on a different chain).

### Enforced blindness

A player only ever sees the single image handed to them on their current turn —
never the original seed, never earlier captions, never the rest of the chain.
The accumulated drift is the source of the fun. Full chains are revealed only at
the end.

### Slow-player handling

Every turn carries the host-set deadline. On expiry, **Claude reads the image
(vision) and writes a caption** in the absent player's place so the chain
advances. Auto-filled steps are flagged in the reveal — fun to spot, and honest
about what happened.

### Reveal & voting

- When all chains complete, the group sees a **reveal**: each chain animates from
  its seed caption through every image/caption to the final image.
- Players then **vote** (funniest image / biggest plot twist); a winner is
  crowned. There is no accuracy/similarity scoring — voting only.

## 2. Scope

### In scope (v1)

- A self-contained, shareable **web app** (create → join → play → reveal → vote).
- **AI as the artist** for every drawing step (Google Imagen / Gemini).
- **AI auto-fill** of missed turns via Claude vision so games never stall.
- **Async play** with a per-turn deadline; no real-time requirement.
- **Durable state** so a game survives server restarts / serverless cold starts.
- Free to build and run on generous API/hosting free tiers.

### Out of scope (YAGNI / deferred)

- **No platform-specific bot** (Discord/Slack/RingCentral) in v1 — link-based only.
- **No accounts/auth** — a player is identified by the `playerId` handed back at
  join, held client-side.
- **No real-time/live mode** — async turns are the whole point.
- **No accuracy scoring** — voting is the only win condition.
- **No scheduled deadline cron in v1** — deadlines are processed lazily on read.
- **Voting logic + endpoints** are deferred to pair with the reveal/voting UI.

### Slice boundaries (as actually built)

The build was sequenced into independently-shippable slices. This spec's
functional requirements are grouped by slice so acceptance can be judged per
slice:

- **Engine** — pure turn/chain/deadline logic, no I/O. _Built._
- **AI wrappers** — image generation + vision caption, behind interfaces. _Built._
- **Backend + API** — persistence + HTTP endpoints. _Built._
- **Web UI + voting** — screens and the vote tally. _Deferred (next slice)._
- **Notifications + deploy hardening** — push, cron, live URL. _Deferred._

## 3. Functional requirements

### Engine (implemented)

- **FR-E1** Seed one chain per player when the host starts the game.
- **FR-E2** Advance a chain when a valid caption is submitted: create the image
  step, then open the next player's caption turn.
- **FR-E3** Run all chains in parallel so each player has exactly one open turn
  per round.
- **FR-E4** Reject acting out of turn: a caption is accepted only from the player
  who owns that open step (`'not your turn'`), only while the game is active, and
  only on an open caption step.
- **FR-E5** On deadline expiry for an open step, trigger AI auto-fill and flag the
  step as auto-filled.
- **FR-E6** Detect completion — when every chain has N steps, move the game to the
  `reveal` phase.
- **FR-E7** Never call an AI provider directly; request all AI work through an
  injected `AIServices` interface (so chain logic is testable with a mock).
- **FR-E8** Accept an injected ID generator (default: per-instance counter) so a
  resumed game can mint globally-unique IDs without collisions.

### AI wrappers (implemented)

- **FR-A1** _Image:_ turn a caption into an image (Google Imagen). Retry with
  backoff; on persistent failure return a **placeholder image** so the chain
  still advances.
- **FR-A2** _Vision:_ turn an image into a caption (Claude, Haiku-class vision
  model) for auto-fill. Accept both `https://` image URLs and base64 data URLs.
- **FR-A3** On caption-generation failure, fall back to a generic safe caption
  ("a mysterious scene") rather than blocking the chain.
- **FR-A4** Absorb all AI failures inside the wrappers — they never surface as
  request errors to the caller.

### Backend + API (implemented)

- **FR-B1** Persist each game as a single JSON row in Supabase; load → run the
  in-memory engine → save back on every request.
- **FR-B2** Guard concurrent writes with optimistic concurrency: a `version`
  column, `save WHERE id=? AND version=?`, reload-and-retry on conflict (bounded
  retries; 409 on exhaustion).
- **FR-B3** Store generated images in Supabase Storage and keep only the **public
  URL** in the game JSON (rows stay small).
- **FR-B4** Process deadlines **lazily** on every state read (no cron required).
- **FR-B5** Expose the five HTTP endpoints below; return player-scoped state
  (never leak other players' pending images/captions).
- **FR-B6** Map errors: unknown game → 404; bad/blank input → 400; engine guard
  violations → 400/409 with the message; version-conflict exhaustion → 409;
  Supabase/network errors → 5xx.

| Method + path | Body / query | Returns |
|---|---|---|
| `POST /api/games` | `{ hostName, turnDeadlineMs }` | `{ gameId, hostId }` |
| `POST /api/games/:id/players` | `{ name }` | `{ playerId }` |
| `POST /api/games/:id/start` | `{ }` (host implied) | updated state |
| `GET /api/games/:id?playerId=…` | — | `{ game, pendingTasks }` (runs lazy deadlines first) |
| `POST /api/games/:id/captions` | `{ playerId, stepId, text }` | updated `{ game, pendingTasks }` |

### Web UI + notifications (deferred)

- **FR-U1** Screens: Lobby, Your-Turn (one image + caption input), Waiting,
  Reveal (animated chains), Voting, Results.
- **FR-U2** Voting engine logic + endpoints and the winner tally.
- **FR-U3** Browser push ("🔔 your turn in DriftDraw!") and an always-current
  shareable status/invite link.
- **FR-U4** A deadline cron for stalled games; a live deployed URL in the README.

## 4. Acceptance criteria

### Overall

- **AC-1** A game can be driven create → join → start → play → `reveal` entirely
  over the HTTP API, offline, using a mock AI layer. _(Met — see the handler
  end-to-end test.)_
- **AC-2** The full test suite (108 Vitest tests) passes on a clean-internet
  machine (GitLab CI / Vercel). Because the dev laptop's network blocks
  `npm install`, CI is the authoritative signal.
- **AC-3** State is durable: a game reloaded from Supabase resumes correctly,
  including ID generation, with no collisions.

### Per-requirement

- **AC-E** Engine tests cover seeding, parallel chain advancement, the
  out-of-turn / not-active / not-open guards, deadline-expiry → auto-fill, and
  completion detection — all against a mock AI. _(Met.)_
- **AC-A** AI-wrapper tests prove: image retry → placeholder fallback; the Claude
  URL branch produces a URL image source while a data URL still produces a base64
  block; empty/whitespace responses fall back to the safe caption. A live smoke
  test hits the real APIs and is skipped without credentials. _(Met.)_
- **AC-B** Backend tests prove the load → run → save loop, a simulated mid-flight
  version bump exercising the retry path, storage upload returning a URL (and the
  placeholder URL on the placeholder image), and the full HTTP game flow with
  correct error codes. _(Met.)_
- **AC-U** _(Deferred)_ A player can complete a real game from the browser and the
  reveal shows every chain with auto-filled steps marked; voting crowns a winner.

### Definition of done for the current submission

The **engine, AI wrappers, and backend/API slices** are done: code complete,
merged/branch-ready, and fully covered by an offline test suite that a reviewer
can run. The **UI and deploy-hardening slices** are explicitly out of scope for
this checkpoint and documented as the next work.
