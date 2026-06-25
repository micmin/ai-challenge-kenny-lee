# DriftDraw — Design Spec

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Working title:** DriftDraw (rename-friendly)

## Summary

DriftDraw is a turn-based, asynchronous party game for 2+ players (sweet spot
3–8), played through a self-contained, shareable web app. Players write captions;
an AI image model redraws each caption; the picture "drifts" hilariously as it
passes through the group. At the end, every chain is revealed start-to-finish and
players vote on the funniest result.

It is built for an AI Challenge. AI is woven into gameplay two ways: an image
model is the "artist" for every drawing step, and Claude (with vision) stands in
for players who miss their turn so games never stall.

## Goals

- A genuinely fun, demoable async multiplayer game.
- "Chat-native" feel: a shareable invite link works inside any messaging app.
- AI visibly part of the gameplay (artist + auto-fill stand-in), not just the build tool.
- Free to build and run (generous API/hosting free tiers).
- Reaches a working, polished demo fast; a platform-specific chat bot can be added later.

## Non-Goals (YAGNI)

- No platform-specific bot (Discord/Slack/RingCentral) in v1 — link-based instead.
- No accuracy/similarity scoring — voting only.
- No accounts/auth — players join a game with a name via the invite link.
- No real-time/live mode — async turns are the whole point.

## Core Decisions (locked)

| Decision | Choice |
|---|---|
| Genre | Gartic-Phone-style telephone game, AI as the artist |
| Core loop | Caption → AI image → caption (humans only caption; AI always draws) |
| Win condition | Light voting at the end ("funniest image / biggest plot twist") |
| Chain flow | Parallel chains — one per player, all rotating simultaneously |
| Slow players | Per-turn deadline; on expiry, Claude (vision) auto-fills the caption |
| Platform | Self-contained web app first; shareable link; browser push notifications |
| Image model | Google Gemini / Imagen |
| Text/vision model | Anthropic Claude (auto-fill captions, optional seed suggestions) |

## Gameplay Detail

### Setup
1. A **host** creates a game and receives an invite link.
2. Players open the link, choose a display name, and join the lobby.
3. Host sets a **per-turn deadline** (e.g. 1h / 8h / 24h) and starts the game.

### The chain
- Each player starts **one chain** with a short seed caption (e.g. "a cat doing taxes").
- Chains then rotate around the group. Each step:
  1. AI (Imagen) renders the current caption into an image.
  2. The chain is handed to the next player, who sees **only that image**.
  3. That player writes a new caption describing the image.
- Each chain passes through **every player exactly once** → with N players, each
  chain has N caption steps. All N chains run in parallel, so each round every
  player has exactly one caption to write (on a different chain).

### Enforced blindness
A player only ever sees the single image handed to them on their current turn —
never the original seed, never earlier captions, never the rest of the chain.
Accumulated drift is the source of the fun. Full chains are revealed only at the end.

### Reveal & voting
- When all chains complete, the group sees a **reveal**: each chain animates from
  seed caption through every image/caption to the final image.
- AI-auto-filled steps are subtly marked (fun to spot, and honest about what happened).
- Players then **vote** (funniest image / biggest plot twist); a winner is crowned.

### Slow-player handling
Every turn carries the host-set deadline. On expiry, **Claude reads the image
(vision) and writes a caption** in the absent player's place so the chain advances.
The auto-filled step is flagged in the reveal.

## Architecture

Six small, independently-testable units. The turn engine is deliberately kept
separate from the AI wrappers so chain logic can be tested without spending money
on image generation.

1. **Game-state store** — persistent model of games, players, chains, steps,
   deadlines, and votes. Backed by Supabase (Postgres).
2. **Lobby / session management** — create game, generate invite link, join with a
   name, host starts the game.
3. **Turn engine** — seeds chains, tracks whose turn it is on each chain, advances
   chains as captions arrive, checks deadlines, triggers auto-fill, detects game
   completion. No direct AI calls — it requests work from the AI layer through an
   interface.
4. **AI services** — two wrappers behind clean interfaces:
   - *Image*: caption → image (Google Imagen).
   - *Text/vision*: image → caption (Claude auto-fill); optional seed suggestions.
5. **Web UI** — screens: Lobby, Your-Turn (shows the one image + caption input),
   Waiting, Reveal (animated chains), Voting, Results.
6. **Notifications** — browser push ("🔔 your turn in DriftDraw!") plus an
   always-current status/invite link the host can re-paste into any chat.

### Data model (sketch)
- `games`: id, host, status (lobby/active/reveal/voting/done), per-turn deadline, created_at.
- `players`: id, game_id, display_name, join order.
- `chains`: id, game_id, seed_player_id.
- `steps`: id, chain_id, position, type (caption/image), author_player_id (nullable
  for AI), content (text caption or image URL), is_auto_filled, deadline, status.
- `votes`: id, game_id, voter_player_id, target_step_id, category.

### Data flow
Host creates game → players join → host starts → engine seeds one chain per player
and opens seed-caption turns → on each caption submit, engine asks the image
service to render, then advances the chain to the next player and opens their turn
→ deadline expiry triggers Claude auto-fill → when every chain has N steps, status
moves to reveal → voting → results.

## Error Handling

- **Image generation failure:** retry with backoff; on persistent failure, insert a
  placeholder image and flag the step, so the chain still advances.
- **Missed deadline:** Claude auto-fill (vision → caption); flag the step.
- **Claude auto-fill failure:** fall back to a generic safe caption ("a mysterious
  scene") and flag; never block the chain.
- **Player drops mid-game:** their remaining turns auto-fill on deadline; game still completes.
- **Content safety:** rely on the image provider's safety filters; on a blocked
  generation, treat as an image failure (placeholder + flag).

## Testing Strategy

- **Turn engine** (highest value, no API cost): unit-test seeding, parallel chain
  advancement, deadline expiry → auto-fill trigger, and completion detection using
  a **mock AI layer**. This is why the engine never calls AI directly.
- **AI wrappers:** thin integration tests against the real APIs, run sparingly;
  mocked everywhere else.
- **End-to-end:** scripted 2- and 4-player games through the API to confirm a game
  reaches reveal with all chains intact, including a forced auto-fill path.

## Proposed Stack

Chosen for "non-engineer building with Claude Code, must be online for async play,
free to run": **Next.js** (single codebase: UI + API routes), deployed on
**Vercel** (free tier), with **Supabase** (free Postgres) for persistent state,
calling the **Anthropic** and **Google Gemini** APIs. One codebase, one deploy.

## Open Questions / Future

- Optional later: wrap a real chat bot (Discord/RingCentral) around the web app.
- Optional later: seed-caption suggestions from Claude for players with writer's block.
- Optional later: themed game modes (movie titles, idioms, etc.).
