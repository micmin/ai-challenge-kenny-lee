# DriftDraw — Retrospective

A reflection on building DriftDraw for the AI Challenge. I'm a product manager
without an engineering background, so this was as much an experiment in *how far
AI-assisted development can go* as it was about shipping a game.

> Where you see _[Kenny: …]_ notes, those are prompts for me to add a personal
> sentence in my own voice before submitting.

## AI tools used

- **Claude Code** — Anthropic's agentic command-line tool — was the primary build
  environment. It wrote essentially all the code, the tests, and the design/plan
  documents, working from my direction.
- **Superpowers** — a skill library on top of Claude Code that imposes a
  `brainstorm → spec → plan → execute` discipline and test-driven development,
  instead of letting the model free-code.
- **Claude models** for the agent's reasoning, and — inside the game itself —
  **Google Imagen** (the in-game "artist") and **Claude vision** (the stand-in
  that fills a caption when a player misses their turn).
- **GitLab CI + Vercel + Supabase** as the cloud toolchain for building, testing,
  and hosting (see "What did not work well").

## Development workflow

I built the game in **four slices**, each shipped end-to-end before starting the
next:

1. **Core engine** — the turn/chain/deadline logic, pure and in-memory.
2. **AI wrappers** — image generation and vision auto-fill, behind clean interfaces.
3. **Backend library + Next.js API** — persistence and HTTP endpoints.
4. **Web UI + deploy hardening** — _not built yet; this is the next slice._

Every slice followed the same loop: **brainstorm** the design interactively,
write it to a committed **spec**, turn that into a detailed **plan**, then
**execute** the plan test-first (often dispatching subagents for independent
pieces). The specs and plans live in `docs/superpowers/`, so the thinking behind
each slice is part of the repo, not lost in chat history. The git log shows the
pattern clearly: a plan lands first, then a run of small `test:`/`feat:`/`fix:`
commits — 36 commits, 108 tests.

## What worked well

- **Spec-first, then code.** Deciding the rules and the shape of each slice *before*
  writing code — and committing that decision as a document — kept the project
  coherent across many sessions. As a PM this played to my strengths: I was making
  product and scope calls, not syntax calls.
- **The "engine touches no I/O" decision.** Keeping the game logic pure, with AI
  and the database behind injected interfaces, meant the trickiest code (parallel
  chains, deadlines, auto-fill) could be tested exhaustively **offline and for
  free** — no image-generation bills to run the test suite. This one architectural
  choice paid off repeatedly.
- **Test-driven development caught my blind spots.** Because I can't eyeball code
  for bugs, the 108 tests were my safety net. The workflow wrote the test first,
  which forced the behavior to be defined before the implementation.
- **Slicing kept scope honest.** Splitting the original "Next.js app" into a
  backend slice and a separate UI slice meant I always had something complete and
  provable, rather than a half-built everything.

## What did not work well

- **The corporate network blocked local development.** My laptop is behind a
  corporate web filter (Cato) that blocks `npm install` from the public npm
  registry. The moment the project needed a new dependency, I could no longer
  install, test, or build locally. This was the single biggest friction point.
  - _Workaround:_ write code locally, but run installs/tests/builds on
    clean-internet machines — GitLab CI and Vercel. It worked, but it slowed the
    feedback loop and meant I couldn't just "run it and see."
- **No live demo yet.** The engine and API are done and tested, but the playable
  UI slice isn't built, so there's no clickable link to show. For a *game*, that's
  the part people most want to see, and it's the part still outstanding.
- **Cloud setup depends on my own accounts.** Getting to a live URL needs me to set
  up Vercel + Supabase and paste in API keys — hands-on steps the AI can't do for
  me. That's still pending.

## Surprises and discoveries

- **How much rode on one architectural choice.** I didn't expect the "keep the
  engine pure" decision to matter as much as it did — but it's the reason the whole
  thing is testable without spending money, and the reason later slices didn't
  disturb the core.
- **Small correctness bugs I'd never have caught.** For example: when a game is
  reloaded from the database, a fresh engine would re-mint IDs that already existed
  (`s1` colliding with the loaded `s1`). The fix — injecting a UUID generator — is
  invisible to a non-engineer but would have caused real, confusing bugs in play.
- **The build tool and the product used the same AI.** Claude is both what built
  the game and a character *in* the game (the auto-fill artist's assistant). That
  double role was a fun discovery about what "AI-native" can mean.
- **Infrastructure, not code, was the hard part.** I assumed writing the code would
  be the bottleneck. It wasn't — the AI handled that. The friction was all around
  it: the network filter, deployment accounts, secret keys.

## Estimated percentage of AI-generated code

**~100%.** As a non-engineer, I did not hand-write the code. Claude Code wrote all
of it — the engine, the AI wrappers, the API, and every test. My contribution was
directing the work: making the product and scope decisions, approving designs,
choosing architectural trade-offs when offered them, and reviewing output. The
*code* is AI-generated; the *decisions* are mine.

## Time spent

**Roughly one full day** of focused effort (about 6–10 hours), spread across
several sessions in late June. The bulk went into brainstorming and directing the
slices; comparatively little went into "fixing code," because the test-first loop
caught most issues before I saw them. _[Kenny: adjust if this feels off, and
optionally note the calendar span vs. hands-on time.]_

## What I would do differently next time

- **Solve the environment first.** Knowing the corporate filter blocks `npm
  install`, I'd set up the clean-internet build/deploy path (CI + Vercel +
  Supabase accounts) on day one, before writing a line — so I'm never blocked
  waiting on infrastructure mid-build.
- **Build a thin slice of UI earlier.** Even one clickable screen against the API
  would have made the project feel real sooner and given me something to demo.
  I'd trade a little backend polish for an earlier visible end-to-end path.
- **Deploy continuously from slice one.** Rather than treating deployment as a
  later step, I'd wire up the live URL early so each slice ships somewhere I can
  see it.
- _[Kenny: add anything you personally found clunky about the workflow.]_

## Key lessons learned

- **AI removes the coding bottleneck; it doesn't remove the thinking.** The
  quality of the result tracked the quality of my specs and decisions, not my
  typing. Time spent brainstorming and scoping paid off far more than time spent
  "generating code."
- **Structure beats vibes.** The `brainstorm → spec → plan → execute` discipline,
  and committing those artifacts, is what let a non-engineer manage a multi-slice
  project without losing the thread.
- **Design for testability and you get correctness for free.** Isolating the game
  logic from all I/O was the highest-leverage decision in the whole project.
- **The real constraints are environmental.** Networks, accounts, and secrets were
  harder than the software. For the next AI-built project, I'll treat the
  environment as a first-class part of the plan, not an afterthought.
- **"Done" is a scope decision.** Being explicit that this submission is
  engine + API (tested), with UI deferred, is more honest and more useful than
  pretending at a finished game — and deciding that boundary is exactly the kind
  of call the AI can't make for me.
