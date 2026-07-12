# DriftDraw Playable Proof (Plan 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-device, deployable playable proof of DriftDraw where one human plays one seat, Claude auto-fills every other seat, and Imagen draws every step.

**Architecture:** Reuse the Plan 1 engine, Plan 2 AI wrappers, and Plan 3a Supabase backend unchanged except for small additive engine methods. Add three endpoints (`solo` create, `step`, `vote`) plus a React `/play` UI driven by a client step-loop that calls `POST /step` once per AI action. The human is the host (`joinOrder 0`); AI seats are all non-host players.

**Tech Stack:** TypeScript, Next.js 15 (App Router), Vitest, Supabase (existing), Anthropic + Google GenAI SDKs (existing). No new dependencies.

## Global Constraints

- The human seat is the host; **an AI seat is any player whose `id !== game.hostId`**. No `isAI` schema field.
- Engine/AI/Plan-3a changes must be **additive and backward-compatible**: the existing 108 tests must stay green.
- Solo games use a **large `turnDeadlineMs`** (`SOLO_TURN_DEADLINE_MS = 1000 * 60 * 60 * 24 * 365`) so lazy `processDeadlines` never auto-fills; all AI fills go through `POST /step`.
- Each `POST /step` performs **exactly one AI action** (one caption + its image render) to stay under Vercel's function timeout. The `step` route sets `export const maxDuration = 60`.
- Client files use `import type` for engine types so the engine runtime is never bundled into the browser.
- Player identity is the `playerId` returned at creation, held client-side (per Plan 3a).
- Run each test with `npx vitest run <path>`; the full suite with `npm test`.

---

### Task 1: Engine — `fillNextAiCaption` (manual AI fill)

**Files:**
- Modify: `src/engine/engine.ts`
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consumes: existing `GameEngine`, `GameStore`, `MockAI` from `src/engine/index`.
- Produces: `GameEngine.fillNextAiCaption(gameId: string, humanPlayerId: string, now: number): Promise<{ filled: boolean; authorName: string | null }>` — fills the next pending caption owned by a non-human seat (using `seedCaption` at position 0, else `captionForImage`), renders its image, advances the chain, and returns whether it filled anything and the author's display name.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/engine.test.ts` (top imports already include `GameEngine`, `GameStore`, `MockAI`):

```ts
describe('fillNextAiCaption', () => {
  it('fills the next non-human pending caption and renders its image', async () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId, hostId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);
    const humanSeed = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, humanSeed.id, 'a cat doing taxes', 0);

    const r = await engine.fillNextAiCaption(gameId, hostId, 0);

    expect(r.filled).toBe(true);
    expect(r.authorName).toBe('AI 1');
    const aiChain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId !== hostId)!;
    expect(aiChain.steps.some((s) => s.type === 'image')).toBe(true);
    expect(aiChain.steps[0].isAutoFilled).toBe(true);
  });

  it('returns filled=false when only human captions are pending', async () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId, hostId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);

    let guard = 0;
    let r = await engine.fillNextAiCaption(gameId, hostId, 0);
    while (r.filled && guard++ < 50) r = await engine.fillNextAiCaption(gameId, hostId, 0);

    expect(r.filled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/engine.test.ts -t "fillNextAiCaption"`
Expected: FAIL — `engine.fillNextAiCaption is not a function`.

- [ ] **Step 3: Implement `fillNextAiCaption` and extract a shared `fillCaption` helper**

In `src/engine/engine.ts`, add a private helper and refactor `processDeadlines` to use it. Replace the body of `processDeadlines` (lines 124–148) and add the two new methods. First, add this private helper directly above `processDeadlines`:

```ts
  // Fill a pending caption via AI (seed prompt at position 0, else caption-for-image),
  // mark it auto-filled, and advance the chain. Shared by processDeadlines and fillNextAiCaption.
  private async fillCaption(game: Game, chain: Chain, step: Step, now: number): Promise<void> {
    if (step.position === 0) {
      step.content = await this.ai.caption.seedCaption();
    } else {
      const prevImage = chain.steps.find((s) => s.position === step.position - 1);
      if (!prevImage) throw new Error('missing preceding image step');
      step.content = await this.ai.caption.captionForImage(prevImage.content);
    }
    step.status = 'filled';
    step.isAutoFilled = true;
    step.deadline = null;
    await this.advanceChain(game, chain, step, now);
  }
```

Replace the existing `processDeadlines` inner fill block so it calls the helper:

```ts
  async processDeadlines(gameId: string, now: number): Promise<void> {
    const game = this.store.get(gameId);
    if (game.status !== 'active') return;
    for (const chain of game.chains) {
      // Snapshot pending overdue captions; advanceChain mutates chain.steps as we go.
      const overdue = chain.steps.filter(
        (s) => s.type === 'caption' && s.status === 'pending' && s.deadline !== null && s.deadline <= now,
      );
      for (const step of overdue) {
        await this.fillCaption(game, chain, step, now);
      }
    }
    this.refreshStatus(game);
    this.store.save(game);
  }

  // Fill the next pending caption owned by a non-human (AI) seat, one per call.
  async fillNextAiCaption(
    gameId: string,
    humanPlayerId: string,
    now: number,
  ): Promise<{ filled: boolean; authorName: string | null }> {
    const game = this.store.get(gameId);
    if (game.status !== 'active') return { filled: false, authorName: null };
    for (const chain of game.chains) {
      const step = chain.steps.find(
        (s) => s.type === 'caption' && s.status === 'pending' && s.authorPlayerId !== humanPlayerId,
      );
      if (step) {
        const author = game.players.find((p) => p.id === step.authorPlayerId) ?? null;
        await this.fillCaption(game, chain, step, now);
        this.refreshStatus(game);
        this.store.save(game);
        return { filled: true, authorName: author ? author.name : null };
      }
    }
    return { filled: false, authorName: null };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/engine/engine.test.ts`
Expected: PASS (new `fillNextAiCaption` tests plus all existing engine tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.test.ts
git commit -m "feat: add engine fillNextAiCaption for on-demand AI fill"
```

---

### Task 2: Engine — `pickWinner` + `Game.winnerChainId`

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/engine.ts`
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Produces: `Game.winnerChainId?: string`; `GameEngine.pickWinner(gameId: string, chainId: string): void` — records the human's chosen chain and moves the game from `reveal` to `done`. Throws `game is not in reveal` or `chain not found`.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/engine.test.ts`:

```ts
describe('pickWinner', () => {
  it('records the winner and completes the game from reveal', async () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId, hostId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);

    let guard = 0;
    while (engine.getGame(gameId).status !== 'reveal' && guard++ < 100) {
      const tasks = engine.getPendingTasks(gameId, hostId);
      if (tasks.length) {
        await engine.submitCaption(gameId, hostId, tasks[0].id, 'human text', 0);
      } else if (!(await engine.fillNextAiCaption(gameId, hostId, 0)).filled) {
        break;
      }
    }
    expect(engine.getGame(gameId).status).toBe('reveal');

    const chainId = engine.getGame(gameId).chains[0].id;
    engine.pickWinner(gameId, chainId);

    expect(engine.getGame(gameId).status).toBe('done');
    expect(engine.getGame(gameId).winnerChainId).toBe(chainId);
  });

  it('rejects picking before reveal', () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);
    expect(() => engine.pickWinner(gameId, 'anything')).toThrow('game is not in reveal');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/engine.test.ts -t "pickWinner"`
Expected: FAIL — `engine.pickWinner is not a function`.

- [ ] **Step 3: Implement**

In `src/engine/types.ts`, add an optional field to `Game` (after `createdAt: number;`):

```ts
  createdAt: number;
  winnerChainId?: string;
```

In `src/engine/engine.ts`, add this method after `isComplete` (before the closing brace of the class):

```ts
  pickWinner(gameId: string, chainId: string): void {
    const game = this.store.get(gameId);
    if (game.status !== 'reveal') throw new Error('game is not in reveal');
    if (!game.chains.some((c) => c.id === chainId)) throw new Error('chain not found');
    game.winnerChainId = chainId;
    game.status = 'done';
    this.store.save(game);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/engine/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/engine.ts src/engine/engine.test.ts
git commit -m "feat: add engine pickWinner + Game.winnerChainId"
```

---

### Task 3: GameService — `createSoloGame`, `stepAi`, `pickWinner`

**Files:**
- Modify: `src/server/game-service.ts`
- Test: `src/server/game-service.test.ts`

**Interfaces:**
- Consumes: `GameEngine.fillNextAiCaption`, `GameEngine.pickWinner`, existing `mutate`, `viewFor`, `createGame`, `joinGame`, `startGame`, `submitCaption`, `getState`.
- Produces (added to `GameServicePort` and `GameService`):
  - `createSoloGame(seed: string, aiCount: number): Promise<{ gameId: string; hostId: string; view: GameView }>`
  - `stepAi(gameId: string, humanPlayerId: string): Promise<StepResult>` where `StepResult = { view: GameView; filled: boolean; authorName: string | null }`
  - `pickWinner(gameId: string, chainId: string): Promise<Game>`

- [ ] **Step 1: Write the failing test**

Add to `src/server/game-service.test.ts` (imports already include `GameService`, `InMemoryGameRepository`, `MockAI`, `uuidIdGenerator`):

```ts
describe('solo game', () => {
  it('plays a full solo game: create → step loop → reveal → pickWinner', async () => {
    const svc = newService();
    const { gameId, hostId, view } = await svc.createSoloGame('a cat doing taxes', 2);
    expect(view.game.players).toHaveLength(3); // You + AI 1 + AI 2

    let cur = view;
    let guard = 0;
    while (cur.game.status !== 'reveal' && guard++ < 200) {
      let stepGuard = 0;
      let stepped = await svc.stepAi(gameId, hostId);
      while (stepped.filled && stepGuard++ < 200) stepped = await svc.stepAi(gameId, hostId);
      cur = stepped.view;
      if (cur.game.status === 'reveal') break;
      cur = await svc.submitCaption(gameId, hostId, cur.pendingTasks[0].id, 'human caption');
    }
    expect(cur.game.status).toBe('reveal');

    const done = await svc.pickWinner(gameId, cur.game.chains[0].id);
    expect(done.status).toBe('done');
    expect(done.winnerChainId).toBe(cur.game.chains[0].id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/game-service.test.ts -t "solo game"`
Expected: FAIL — `svc.createSoloGame is not a function`.

- [ ] **Step 3: Implement**

In `src/server/game-service.ts`, add the constant and result type near the top (after the imports):

```ts
export const SOLO_TURN_DEADLINE_MS = 1000 * 60 * 60 * 24 * 365; // 1 year: deadlines never fire in solo play

export interface StepResult {
  view: GameView;
  filled: boolean;
  authorName: string | null;
}
```

Extend the `GameServicePort` interface (add these three members inside it):

```ts
  createSoloGame(seed: string, aiCount: number): Promise<{ gameId: string; hostId: string; view: GameView }>;
  stepAi(gameId: string, humanPlayerId: string): Promise<StepResult>;
  pickWinner(gameId: string, chainId: string): Promise<Game>;
```

Add the three methods to the `GameService` class (before the private `mutate`):

```ts
  async createSoloGame(
    seed: string,
    aiCount: number,
  ): Promise<{ gameId: string; hostId: string; view: GameView }> {
    const { gameId, hostId } = await this.createGame('You', SOLO_TURN_DEADLINE_MS);
    for (let i = 0; i < aiCount; i += 1) {
      await this.joinGame(gameId, `AI ${i + 1}`);
    }
    await this.startGame(gameId);
    const started = await this.getState(gameId, hostId);
    const seedStep = started.pendingTasks[0]; // the human's own seed caption (position 0)
    const view = await this.submitCaption(gameId, hostId, seedStep.id, seed);
    return { gameId, hostId, view };
  }

  async stepAi(gameId: string, humanPlayerId: string): Promise<StepResult> {
    let filled = false;
    let authorName: string | null = null;
    const game = await this.mutate(gameId, async (engine) => {
      const r = await engine.fillNextAiCaption(gameId, humanPlayerId, this.now());
      filled = r.filled;
      authorName = r.authorName;
    });
    return { view: this.viewFor(game, humanPlayerId), filled, authorName };
  }

  async pickWinner(gameId: string, chainId: string): Promise<Game> {
    return this.mutate(gameId, (engine) => engine.pickWinner(gameId, chainId));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/game-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/game-service.ts src/server/game-service.test.ts
git commit -m "feat: add GameService createSoloGame, stepAi, pickWinner"
```

---

### Task 4: HTTP handlers + error mapping

**Files:**
- Modify: `src/server/http/handlers.ts`, `src/server/http/responses.ts`
- Test: `src/server/http/handlers.test.ts`

**Interfaces:**
- Consumes: `GameServicePort.createSoloGame/stepAi/pickWinner`, existing `readJson`, `requireString`, `json`, `errorToResponse`, `BadRequestError`.
- Produces: `createSoloGameHandler(service, request)`, `stepHandler(service, gameId, request)`, `pickWinnerHandler(service, gameId, request)` — all `Promise<Response>`.

- [ ] **Step 1: Write the failing tests**

First, extend `fakeService` in `src/server/http/handlers.test.ts` so it satisfies the widened port — add these three entries inside the returned object (before `...overrides`):

```ts
    createSoloGame: vi.fn(async () => ({ gameId: 'g1', hostId: 'p1', view: { game: { id: 'g1' } as any, pendingTasks: [] } })),
    stepAi: vi.fn(async () => ({ view: { game: { id: 'g1', status: 'active' } as any, pendingTasks: [] }, filled: false, authorName: null })),
    pickWinner: vi.fn(async () => ({ id: 'g1', status: 'done' } as any)),
```

Add the import of the new handlers to the top import block, then add these tests:

```ts
import {
  createGameHandler,
  joinGameHandler,
  startGameHandler,
  getStateHandler,
  submitCaptionHandler,
  createSoloGameHandler,
  stepHandler,
  pickWinnerHandler,
} from './handlers';

describe('createSoloGameHandler', () => {
  it('creates a solo game from a valid body', async () => {
    const svc = fakeService();
    const res = await createSoloGameHandler(svc, post({ seed: 'a cat', aiCount: 3 }));
    expect(res.status).toBe(201);
    expect(svc.createSoloGame).toHaveBeenCalledWith('a cat', 3);
  });
  it('rejects a blank seed with 400', async () => {
    const res = await createSoloGameHandler(fakeService(), post({ seed: ' ', aiCount: 3 }));
    expect(res.status).toBe(400);
  });
  it('rejects aiCount out of range with 400', async () => {
    const res = await createSoloGameHandler(fakeService(), post({ seed: 'a cat', aiCount: 0 }));
    expect(res.status).toBe(400);
  });
});

describe('stepHandler', () => {
  it('steps with a valid playerId', async () => {
    const svc = fakeService();
    const res = await stepHandler(svc, 'g1', post({ playerId: 'p1' }));
    expect(res.status).toBe(200);
    expect(svc.stepAi).toHaveBeenCalledWith('g1', 'p1');
  });
  it('rejects a missing playerId with 400', async () => {
    const res = await stepHandler(fakeService(), 'g1', post({}));
    expect(res.status).toBe(400);
  });
});

describe('pickWinnerHandler', () => {
  it('records a pick with a valid chainId', async () => {
    const svc = fakeService();
    const res = await pickWinnerHandler(svc, 'g1', post({ chainId: 'c1' }));
    expect(res.status).toBe(200);
    expect(svc.pickWinner).toHaveBeenCalledWith('g1', 'c1');
  });
  it('rejects a missing chainId with 400', async () => {
    const res = await pickWinnerHandler(fakeService(), 'g1', post({}));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/http/handlers.test.ts -t "createSoloGameHandler"`
Expected: FAIL — `createSoloGameHandler is not exported`.

- [ ] **Step 3: Implement the handlers**

Append to `src/server/http/handlers.ts`:

```ts
export async function createSoloGameHandler(service: GameServicePort, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const seed = requireString(body.seed, 'seed');
    const aiCount = body.aiCount;
    if (typeof aiCount !== 'number' || !Number.isInteger(aiCount) || aiCount < 1 || aiCount > 7) {
      throw new BadRequestError('aiCount must be an integer between 1 and 7');
    }
    return json(await service.createSoloGame(seed, aiCount), 201);
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function stepHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const playerId = requireString(body.playerId, 'playerId');
    return json(await service.stepAi(gameId, playerId));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function pickWinnerHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const chainId = requireString(body.chainId, 'chainId');
    return json(await service.pickWinner(gameId, chainId));
  } catch (err) {
    return errorToResponse(err);
  }
}
```

- [ ] **Step 4: Add error mapping for the new engine guards**

In `src/server/http/responses.ts`, add `'game is not in reveal'` to the `GAME_RULE_ERRORS` set:

```ts
const GAME_RULE_ERRORS = new Set([
  'need at least 2 players',
  'game already started',
  'not your turn',
  'game is not active',
  'step is not an open caption',
  'game is not in reveal',
]);
```

And add a `chain not found` → 404 mapping inside `errorToResponse`, right after the `step not found` line:

```ts
    if (err.message.startsWith('chain not found')) return json({ error: err.message }, 404);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/server/http/handlers.test.ts`
Expected: PASS (new handler tests plus existing ones with the widened fake).

- [ ] **Step 6: Commit**

```bash
git add src/server/http/handlers.ts src/server/http/responses.ts src/server/http/handlers.test.ts
git commit -m "feat: add solo/step/vote HTTP handlers + error mapping"
```

---

### Task 5: Next.js API routes

**Files:**
- Create: `src/app/api/games/solo/route.ts`
- Create: `src/app/api/games/[id]/step/route.ts`
- Create: `src/app/api/games/[id]/vote/route.ts`

**Interfaces:**
- Consumes: `createSoloGameHandler`, `stepHandler`, `pickWinnerHandler`, `getGameService`.
- Produces: three App Router route handlers (thin wrappers, matching existing route files).

- [ ] **Step 1: Create the solo route**

`src/app/api/games/solo/route.ts`:

```ts
import { createSoloGameHandler } from '../../../../server/http/handlers';
import { getGameService } from '../../../../server/http/service';

export async function POST(request: Request): Promise<Response> {
  return createSoloGameHandler(getGameService(), request);
}
```

- [ ] **Step 2: Create the step route (with maxDuration)**

`src/app/api/games/[id]/step/route.ts`:

```ts
import { stepHandler } from '../../../../../server/http/handlers';
import { getGameService } from '../../../../../server/http/service';

export const maxDuration = 60;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return stepHandler(getGameService(), id, request);
}
```

- [ ] **Step 3: Create the vote route**

`src/app/api/games/[id]/vote/route.ts`:

```ts
import { pickWinnerHandler } from '../../../../../server/http/handlers';
import { getGameService } from '../../../../../server/http/service';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return pickWinnerHandler(getGameService(), id, request);
}
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS — build lists `ƒ /api/games/solo`, `ƒ /api/games/[id]/step`, `ƒ /api/games/[id]/vote`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/games/solo/route.ts "src/app/api/games/[id]/step/route.ts" "src/app/api/games/[id]/vote/route.ts"
git commit -m "feat: wire solo/step/vote Next.js API routes"
```

---

### Task 6: Client API module

**Files:**
- Create: `src/app/play/api.ts`
- Test: `src/app/play/api.test.ts`

**Interfaces:**
- Produces: `GameView`, `StepResult` types and `createSolo`, `stepAi`, `submitCaption`, `pickWinner` fetch wrappers.

- [ ] **Step 1: Write the failing test**

`src/app/play/api.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSolo, stepAi } from './api';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('client api', () => {
  it('createSolo posts seed + aiCount and returns the payload', async () => {
    const payload = { gameId: 'g1', hostId: 'p1', view: { game: { id: 'g1' }, pendingTasks: [] } };
    const fetchMock = vi.fn(async () => jsonResponse(payload, 201));
    vi.stubGlobal('fetch', fetchMock);

    const r = await createSolo('a cat', 3);

    expect(fetchMock).toHaveBeenCalledWith('/api/games/solo', expect.objectContaining({ method: 'POST' }));
    expect(r.gameId).toBe('g1');
  });

  it('stepAi throws the server error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 409)));
    await expect(stepAi('g1', 'p1')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/play/api.test.ts`
Expected: FAIL — cannot find module `./api`.

- [ ] **Step 3: Implement**

`src/app/play/api.ts`:

```ts
import type { Game, Step } from '../../engine/index';

export interface GameView {
  game: Game;
  pendingTasks: Step[];
}

export interface StepResult {
  view: GameView;
  filled: boolean;
  authorName: string | null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function createSolo(seed: string, aiCount: number): Promise<{ gameId: string; hostId: string; view: GameView }> {
  return postJson('/api/games/solo', { seed, aiCount });
}

export function stepAi(gameId: string, playerId: string): Promise<StepResult> {
  return postJson(`/api/games/${gameId}/step`, { playerId });
}

export function submitCaption(gameId: string, playerId: string, stepId: string, text: string): Promise<GameView> {
  return postJson(`/api/games/${gameId}/captions`, { playerId, stepId, text });
}

export function pickWinner(gameId: string, chainId: string): Promise<Game> {
  return postJson(`/api/games/${gameId}/vote`, { chainId });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/play/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/play/api.ts src/app/play/api.test.ts
git commit -m "feat: add client API module for the play UI"
```

---

### Task 7: Screen-derivation helpers

**Files:**
- Create: `src/app/play/screen.ts`
- Test: `src/app/play/screen.test.ts`

**Interfaces:**
- Produces: `Screen` type; `deriveScreen(game: Game): Screen`; `imageForTask(game: Game, task: Step): string | null` (the image the human's pending caption describes = the image step one position earlier); `roundOf(task: Step): number`.

- [ ] **Step 1: Write the failing test**

`src/app/play/screen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveScreen, imageForTask, roundOf } from './screen';
import type { Game, Step } from '../../engine/index';

function caption(chainId: string, position: number): Step {
  return { id: `s${position}`, chainId, position, type: 'caption', authorPlayerId: 'p1', content: '', isAutoFilled: false, status: 'pending', deadline: null };
}

describe('deriveScreen', () => {
  it('maps status to a screen', () => {
    expect(deriveScreen({ status: 'active' } as Game)).toBe('yourTurn');
    expect(deriveScreen({ status: 'reveal' } as Game)).toBe('reveal');
    expect(deriveScreen({ status: 'done' } as Game)).toBe('done');
  });
});

describe('imageForTask', () => {
  it('returns the image one position before the caption task', () => {
    const game = {
      chains: [{ id: 'c1', gameId: 'g1', seedPlayerId: 'p1', steps: [
        { id: 's0', chainId: 'c1', position: 0, type: 'caption', authorPlayerId: 'p2', content: 'seed', isAutoFilled: true, status: 'filled', deadline: null },
        { id: 's1', chainId: 'c1', position: 1, type: 'image', authorPlayerId: null, content: 'img://x', isAutoFilled: false, status: 'filled', deadline: null },
      ] }],
    } as unknown as Game;
    expect(imageForTask(game, caption('c1', 2))).toBe('img://x');
  });
  it('returns null for a seed task (position 0)', () => {
    const game = { chains: [{ id: 'c1', steps: [] }] } as unknown as Game;
    expect(imageForTask(game, caption('c1', 0))).toBeNull();
  });
});

describe('roundOf', () => {
  it('is 1-based on caption position', () => {
    expect(roundOf(caption('c1', 0))).toBe(1);
    expect(roundOf(caption('c1', 2))).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/play/screen.test.ts`
Expected: FAIL — cannot find module `./screen`.

- [ ] **Step 3: Implement**

`src/app/play/screen.ts`:

```ts
import type { Game, Step } from '../../engine/index';

export type Screen = 'start' | 'yourTurn' | 'reveal' | 'done';

export function deriveScreen(game: Game): Screen {
  if (game.status === 'reveal' || game.status === 'voting') return 'reveal';
  if (game.status === 'done') return 'done';
  return 'yourTurn';
}

export function imageForTask(game: Game, task: Step): string | null {
  const chain = game.chains.find((c) => c.id === task.chainId);
  if (!chain) return null;
  const image = chain.steps.find((s) => s.type === 'image' && s.position === task.position - 1);
  return image ? image.content : null;
}

export function roundOf(task: Step): number {
  return Math.floor(task.position / 2) + 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/play/screen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/play/screen.ts src/app/play/screen.test.ts
git commit -m "feat: add screen-derivation helpers for the play UI"
```

---

### Task 8: Presentational screen components

**Files:**
- Create: `src/app/play/screens.tsx`

**Interfaces:**
- Consumes: `imageForTask` is applied by the caller; these components receive plain props.
- Produces: `StartScreen`, `AiPlayingScreen`, `YourTurnScreen`, `RevealScreen`, `ResultsScreen` React components.

- [ ] **Step 1: Create the components**

`src/app/play/screens.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { Game } from '../../engine/index';

const box: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 12, padding: 16, marginTop: 16 };
const img: React.CSSProperties = { maxWidth: '100%', borderRadius: 8, display: 'block' };

export function StartScreen({ busy, onStart }: { busy: boolean; onStart: (seed: string, aiCount: number) => void }) {
  const [seed, setSeed] = useState('');
  const [aiCount, setAiCount] = useState(3);
  return (
    <section style={box}>
      <p>You play one seat; the AI plays the rest and draws every picture.</p>
      <label>AI opponents:{' '}
        <select value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))} disabled={busy}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <p style={{ marginTop: 12 }}>Your opening idea:</p>
      <input style={{ width: '100%', padding: 8 }} value={seed} disabled={busy}
        placeholder="a cat doing taxes" onChange={(e) => setSeed(e.target.value)} />
      <button style={{ marginTop: 12, padding: '8px 16px' }} disabled={busy || seed.trim() === ''}
        onClick={() => onStart(seed.trim(), aiCount)}>
        {busy ? 'Starting…' : 'Start game'}
      </button>
    </section>
  );
}

export function AiPlayingScreen({ feed }: { feed: string[] }) {
  return (
    <section style={box}>
      <p>🤖 The AI is playing…</p>
      <ul>{feed.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </section>
  );
}

export function YourTurnScreen({
  image, round, total, busy, onSubmit,
}: { image: string | null; round: number; total: number; busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <section style={box}>
      <p>Round {round} of {total} — what is this?</p>
      {image ? <img src={image} alt="the image handed to you" style={img} /> : <p>(no image)</p>}
      <input style={{ width: '100%', padding: 8, marginTop: 12 }} value={text} disabled={busy}
        placeholder="write a caption" onChange={(e) => setText(e.target.value)} />
      <button style={{ marginTop: 12, padding: '8px 16px' }} disabled={busy || text.trim() === ''}
        onClick={() => { onSubmit(text.trim()); setText(''); }}>
        {busy ? 'Submitting…' : 'Submit'}
      </button>
    </section>
  );
}

export function RevealScreen({ game, busy, onPick }: { game: Game; busy: boolean; onPick: (chainId: string) => void }) {
  return (
    <section style={box}>
      <h2>The big reveal</h2>
      {game.chains.map((chain) => (
        <div key={chain.id} style={{ ...box, background: '#fafafa' }}>
          {chain.steps.map((step) => (
            <div key={step.id} style={{ marginBottom: 8 }}>
              {step.type === 'image'
                ? <img src={step.content} alt="drawn step" style={img} />
                : <p>“{step.content}”{step.isAutoFilled ? ' 🤖' : ''}</p>}
            </div>
          ))}
          <button disabled={busy} onClick={() => onPick(chain.id)}>Pick this one as funniest</button>
        </div>
      ))}
    </section>
  );
}

export function ResultsScreen({ game, onPlayAgain }: { game: Game; onPlayAgain: () => void }) {
  const winner = game.chains.find((c) => c.id === game.winnerChainId);
  const finalImage = winner?.steps.filter((s) => s.type === 'image').at(-1);
  return (
    <section style={box}>
      <h2>Your pick</h2>
      {finalImage ? <img src={finalImage.content} alt="the chain you picked" style={img} /> : <p>No pick recorded.</p>}
      <button style={{ marginTop: 12, padding: '8px 16px' }} onClick={onPlayAgain}>Play again</button>
    </section>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/play/screens.tsx
git commit -m "feat: add presentational screen components for the play UI"
```

---

### Task 9: Play page orchestrator

**Files:**
- Create: `src/app/play/page.tsx`

**Interfaces:**
- Consumes: `createSolo`, `stepAi`, `submitCaption`, `pickWinner` from `./api`; `deriveScreen`, `imageForTask`, `roundOf` from `./screen`; the screen components from `./screens`.
- Produces: the default-exported `/play` client page implementing the state machine (start → step-loop → your-turn → … → reveal → results).

- [ ] **Step 1: Create the page**

`src/app/play/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { createSolo, stepAi, submitCaption, pickWinner, type GameView } from './api';
import { deriveScreen, imageForTask, roundOf } from './screen';
import { StartScreen, AiPlayingScreen, YourTurnScreen, RevealScreen, ResultsScreen } from './screens';

type Phase = 'start' | 'stepping' | 'yourTurn' | 'reveal' | 'done';

export default function PlayPage() {
  const [phase, setPhase] = useState<Phase>('start');
  const [gameId, setGameId] = useState('');
  const [hostId, setHostId] = useState('');
  const [view, setView] = useState<GameView | null>(null);
  const [feed, setFeed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runStepLoop(gId: string, hId: string) {
    setPhase('stepping');
    setFeed([]);
    for (let guard = 0; guard < 500; guard += 1) {
      const result = await stepAi(gId, hId);
      if (result.filled) {
        setView(result.view);
        setFeed((f) => [...f, `🤖 ${result.authorName ?? 'AI'} — Claude captioned, 🎨 Imagen drew`]);
        continue;
      }
      setView(result.view);
      const next = deriveScreen(result.view.game);
      setPhase(next === 'reveal' ? 'reveal' : next === 'done' ? 'done' : 'yourTurn');
      return;
    }
    setError('too many AI steps — stopping');
  }

  async function handleStart(seed: string, aiCount: number) {
    setBusy(true); setError(null);
    try {
      const { gameId: gId, hostId: hId } = await createSolo(seed, aiCount);
      setGameId(gId); setHostId(hId);
      await runStepLoop(gId, hId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function handleSubmit(text: string) {
    if (!view) return;
    setBusy(true); setError(null);
    try {
      await submitCaption(gameId, hostId, view.pendingTasks[0].id, text);
      await runStepLoop(gameId, hostId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function handlePick(chainId: string) {
    setBusy(true); setError(null);
    try {
      const game = await pickWinner(gameId, chainId);
      setView((v) => (v ? { ...v, game } : v));
      setPhase('done');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function playAgain() {
    setPhase('start'); setView(null); setFeed([]); setError(null);
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 680, margin: '0 auto' }}>
      <h1>DriftDraw</h1>
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
      {phase === 'start' && <StartScreen busy={busy} onStart={handleStart} />}
      {phase === 'stepping' && <AiPlayingScreen feed={feed} />}
      {phase === 'yourTurn' && view && (
        <YourTurnScreen
          image={imageForTask(view.game, view.pendingTasks[0])}
          round={roundOf(view.pendingTasks[0])}
          total={view.game.players.length}
          busy={busy}
          onSubmit={handleSubmit}
        />
      )}
      {phase === 'reveal' && view && <RevealScreen game={view.game} busy={busy} onPick={handlePick} />}
      {phase === 'done' && view && <ResultsScreen game={view.game} onPlayAgain={playAgain} />}
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS — build lists `○ /play` (or `ƒ /play`).

- [ ] **Step 3: Commit**

```bash
git add src/app/play/page.tsx
git commit -m "feat: add /play page orchestrating the solo game loop"
```

---

### Task 10: Home link + full verification

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:** none (leaf task).

- [ ] **Step 1: Update the homepage to link to /play**

Replace `src/app/page.tsx` with:

```tsx
export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 640 }}>
      <h1>DriftDraw</h1>
      <p>The async multiplayer telephone drawing game — AI draws every picture.</p>
      <p><a href="/play">▶️ Play the solo demo</a></p>
    </main>
  );
}
```

- [ ] **Step 2: Run the full pipeline**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS — all tests green (existing 108 + the new engine/service/handler/client tests), build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: link homepage to the /play solo demo"
```

- [ ] **Step 4: Manual smoke test (requires deploy or local .env with AI keys)**

Once `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and Supabase env vars are set (locally in `.env` or on Vercel): open `/play`, start a game with 2–3 AI opponents, caption each round, watch the AI feed, reach the reveal, and pick a favourite. Confirm real images appear and AI-filled captions carry the 🤖 marker.

---

## Self-Review

**1. Spec coverage:**
- Start / seed caption → Task 8 `StartScreen`, Task 3 `createSoloGame`. ✓
- Your-Turn (single image, blindness) → Task 7 `imageForTask` (only the current image is shown), Task 8/9. ✓
- AI-playing stepped feed → Task 1 `fillNextAiCaption`, Task 3 `stepAi`, Task 9 `runStepLoop`. ✓
- Reveal + AI-filled markers → Task 8 `RevealScreen` (`isAutoFilled` → 🤖). ✓
- Pick the funniest → Task 2 `pickWinner`, Task 4 vote handler, Task 8 buttons. ✓
- Results → Task 8 `ResultsScreen`. ✓
- Solo setup (human seed + Claude AI seeds via the step loop) → Task 3 + Task 1 (AI position-0 seeds filled via `fillNextAiCaption`/`seedCaption`). ✓
- Reuse Supabase backend → no repo/storage changes; `getGameService` unchanged. ✓
- Vercel timeout safety → Task 5 `maxDuration = 60`, one AI action per `/step`. ✓
- Error handling (AI absorbed in wrappers, refresh/resume via Supabase, validation) → wrappers unchanged; `getState` still available for resume; Task 4 validation. ✓
- Offline tests with MockAI + in-memory repo → Tasks 1, 3, 4, 6, 7. ✓
- **Seed-caption note:** the spec described seeding AI chains "at creation"; this plan fills them via the step loop (`seedCaption` on the AI position-0 caption). Same result (Claude authors AI seeds), and it keeps the create request fast and makes AI seeding visible in the feed. No spec requirement dropped.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**3. Type consistency:** `GameView`, `StepResult`, `createSoloGame`, `stepAi`, `pickWinner`, `fillNextAiCaption`, `winnerChainId`, `imageForTask`, `roundOf`, `deriveScreen` are used with identical signatures across tasks. Client wrappers return the same shapes the service produces. ✓

**Deployment dependencies (owner: Kenny, outside the code tasks):** obtain the missing AI key; set up Vercel + Supabase per `DEPLOYMENT.md`. These gate the Task 10 Step 4 smoke test, not the offline tests/build.
