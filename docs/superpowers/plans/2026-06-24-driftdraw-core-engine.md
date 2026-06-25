# DriftDraw Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript core of DriftDraw — game state, turn engine, and a mock AI layer — so a full N-player "telephone" game can be simulated and unit-tested with no external APIs, no database, and no UI.

**Architecture:** Framework-agnostic TypeScript under `src/engine/`. A `GameStore` holds state in memory; a `GameEngine` contains all game logic and talks to AI only through an `AIServices` interface; a `MockAI` implements that interface deterministically for tests. Time is injected (`now` passed into methods) so deadline logic is testable without real clocks. This engine drops unchanged into the Next.js app in a later plan.

**Tech Stack:** TypeScript (ESM, strict), Vitest for testing. No runtime dependencies.

**Scope note:** This is Plan 1 of ~4. It deliberately excludes Next.js, Supabase, real AI calls, UI, and notifications. The engine code written here is portable and will be imported as-is by later plans.

---

## File Structure

- `package.json` — project manifest, scripts, devDeps (TypeScript, Vitest).
- `tsconfig.json` — strict TypeScript config.
- `vitest.config.ts` — Vitest config (node env, globals).
- `.gitignore` — ignore `node_modules`.
- `src/engine/types.ts` — domain types (Game, Player, Chain, Step, enums). No behavior.
- `src/engine/ai.ts` — `AIServices` interface + deterministic `MockAI` implementation.
- `src/engine/store.ts` — `GameStore`: in-memory save/get of games.
- `src/engine/engine.ts` — `GameEngine`: all game logic (create/join/start, submit, deadlines, completion).
- Test files live next to their source as `*.test.ts`.

### Domain model (locked — used by all tasks)

```ts
type GameStatus = 'lobby' | 'active' | 'reveal' | 'voting' | 'done';
type StepType = 'caption' | 'image';
type StepStatus = 'pending' | 'filled';

interface Player { id: string; name: string; joinOrder: number; }

interface Step {
  id: string;
  chainId: string;
  position: number;            // 0-based index within the chain
  type: StepType;
  authorPlayerId: string | null; // assigned player for captions; null for AI images
  content: string;             // caption text, or image reference for image steps
  isAutoFilled: boolean;       // true when an AI filled a missed caption turn
  status: StepStatus;
  deadline: number | null;     // epoch ms; only set on pending caption steps
}

interface Chain { id: string; gameId: string; seedPlayerId: string; steps: Step[]; }

interface Game {
  id: string;
  hostId: string;
  status: GameStatus;
  turnDeadlineMs: number;
  players: Player[];
  chains: Chain[];
  createdAt: number;
}
```

### Chain math (the rules every task relies on)

- With **N** players there are **N chains** — chain `j` is seeded by `players[j]`.
- Each chain has **N caption-indices** `k = 0..N-1`. The author of caption-index `k`
  on the chain seeded by player index `j` is `players[(j + k) % N]`.
  - `k = 0` is the seed caption, written by the seed player.
  - This guarantees each chain is captioned by every player exactly once.
- A chain interleaves caption and image steps: caption-index `k` occupies step
  `position 2k` (caption) and `position 2k+1` (AI image of that caption).
- A complete chain has `2N` steps, all `status: 'filled'`.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Test: `src/engine/scaffold.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "driftdraw",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node' },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
dist
.env
.env.local
```

- [ ] **Step 5: Create a smoke test `src/engine/scaffold.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes without errors; `node_modules/` created.

- [ ] **Step 7: Run the smoke test**

Run: `npm test`
Expected: PASS — 1 test passing.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/engine/scaffold.test.ts
git commit -m "chore: scaffold TypeScript + Vitest project"
```

---

## Task 2: Domain types

**Files:**
- Create: `src/engine/types.ts`
- Test: `src/engine/types.test.ts`

- [ ] **Step 1: Write a failing test that constructs each type**

`src/engine/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Game, Player, Chain, Step } from './types';

describe('domain types', () => {
  it('compiles a fully-formed game object', () => {
    const player: Player = { id: 'p1', name: 'Ada', joinOrder: 0 };
    const step: Step = {
      id: 's1',
      chainId: 'c1',
      position: 0,
      type: 'caption',
      authorPlayerId: 'p1',
      content: 'a cat doing taxes',
      isAutoFilled: false,
      status: 'pending',
      deadline: 1000,
    };
    const chain: Chain = { id: 'c1', gameId: 'g1', seedPlayerId: 'p1', steps: [step] };
    const game: Game = {
      id: 'g1',
      hostId: 'p1',
      status: 'active',
      turnDeadlineMs: 60_000,
      players: [player],
      chains: [chain],
      createdAt: 0,
    };
    expect(game.chains[0].steps[0].type).toBe('caption');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- types`
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 3: Create `src/engine/types.ts`**

```ts
export type GameStatus = 'lobby' | 'active' | 'reveal' | 'voting' | 'done';
export type StepType = 'caption' | 'image';
export type StepStatus = 'pending' | 'filled';

export interface Player {
  id: string;
  name: string;
  joinOrder: number;
}

export interface Step {
  id: string;
  chainId: string;
  position: number;
  type: StepType;
  authorPlayerId: string | null;
  content: string;
  isAutoFilled: boolean;
  status: StepStatus;
  deadline: number | null;
}

export interface Chain {
  id: string;
  gameId: string;
  seedPlayerId: string;
  steps: Step[];
}

export interface Game {
  id: string;
  hostId: string;
  status: GameStatus;
  turnDeadlineMs: number;
  players: Player[];
  chains: Chain[];
  createdAt: number;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- types`
Expected: PASS.

- [ ] **Step 5: Verify types compile cleanly**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/types.test.ts
git commit -m "feat: add DriftDraw domain types"
```

---

## Task 3: Mock AI services

**Files:**
- Create: `src/engine/ai.ts`
- Test: `src/engine/ai.test.ts`

The engine depends only on the `AIServices` interface. `MockAI` is deterministic so
tests can trace how content drifts. `captionForImage` deliberately wraps the prior
content in `"a drawing of ..."` so drift is visible in assertions and demos.

- [ ] **Step 1: Write failing tests**

`src/engine/ai.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MockAI } from './ai';

describe('MockAI image service', () => {
  it('renders a caption into a deterministic image reference', async () => {
    const ai = new MockAI();
    const img = await ai.image.generate('a cat doing taxes');
    expect(img).toBe('mock-image://a%20cat%20doing%20taxes');
  });
});

describe('MockAI caption service', () => {
  it('captions an image by referencing its content (visible drift)', async () => {
    const ai = new MockAI();
    const caption = await ai.caption.captionForImage('mock-image://a%20cat%20doing%20taxes');
    expect(caption).toBe('a drawing of a cat doing taxes');
  });

  it('produces deterministic, cycling seed captions', async () => {
    const ai = new MockAI();
    const first = await ai.caption.seedCaption();
    const second = await ai.caption.seedCaption();
    expect(first).toBe('a cat doing taxes');
    expect(second).toBe('a dog astronaut');
    expect(first).not.toBe(second);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ai`
Expected: FAIL — cannot find module `./ai`.

- [ ] **Step 3: Implement `src/engine/ai.ts`**

```ts
export interface ImageService {
  generate(caption: string): Promise<string>;
}

export interface CaptionService {
  captionForImage(imageContent: string): Promise<string>;
  seedCaption(): Promise<string>;
}

export interface AIServices {
  image: ImageService;
  caption: CaptionService;
}

const SEED_CAPTIONS = [
  'a cat doing taxes',
  'a dog astronaut',
  'a robot baking bread',
  'a penguin surfing',
];

export class MockAI implements AIServices {
  private seedIndex = 0;

  image: ImageService = {
    generate: async (caption: string) => `mock-image://${encodeURIComponent(caption)}`,
  };

  caption: CaptionService = {
    captionForImage: async (imageContent: string) => {
      const inner = decodeURIComponent(imageContent.replace('mock-image://', ''));
      return `a drawing of ${inner}`;
    },
    seedCaption: async () => {
      const seed = SEED_CAPTIONS[this.seedIndex % SEED_CAPTIONS.length];
      this.seedIndex += 1;
      return seed;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ai`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai.ts src/engine/ai.test.ts
git commit -m "feat: add AIServices interface and deterministic MockAI"
```

---

## Task 4: In-memory game store

**Files:**
- Create: `src/engine/store.ts`
- Test: `src/engine/store.test.ts`

The store is intentionally dumb: it saves and retrieves `Game` objects by id. All
logic lives in the engine. `get` throws on a missing id so bugs surface loudly.

- [ ] **Step 1: Write failing tests**

`src/engine/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameStore } from './store';
import type { Game } from './types';

function makeGame(id: string): Game {
  return {
    id,
    hostId: 'p1',
    status: 'lobby',
    turnDeadlineMs: 60_000,
    players: [],
    chains: [],
    createdAt: 0,
  };
}

describe('GameStore', () => {
  it('saves and retrieves a game by id', () => {
    const store = new GameStore();
    store.save(makeGame('g1'));
    expect(store.get('g1').id).toBe('g1');
  });

  it('reports whether a game exists', () => {
    const store = new GameStore();
    expect(store.has('g1')).toBe(false);
    store.save(makeGame('g1'));
    expect(store.has('g1')).toBe(true);
  });

  it('throws when getting a missing game', () => {
    const store = new GameStore();
    expect(() => store.get('nope')).toThrow('Game not found: nope');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- store`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Implement `src/engine/store.ts`**

```ts
import type { Game } from './types';

export class GameStore {
  private games = new Map<string, Game>();

  save(game: Game): void {
    this.games.set(game.id, game);
  }

  has(id: string): boolean {
    return this.games.has(id);
  }

  get(id: string): Game {
    const game = this.games.get(id);
    if (!game) throw new Error(`Game not found: ${id}`);
    return game;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- store`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/store.ts src/engine/store.test.ts
git commit -m "feat: add in-memory GameStore"
```

---

## Task 5: Engine — create, join, and start a game

**Files:**
- Create: `src/engine/engine.ts`
- Test: `src/engine/engine.test.ts`

Introduces `GameEngine` with injected `store` and `ai`, a private id generator, and
the lobby lifecycle. `startGame` seeds one chain per player, each with a single
pending seed-caption step assigned to that chain's seed player.

- [ ] **Step 1: Write failing tests**

`src/engine/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameEngine } from './engine';
import { GameStore } from './store';
import { MockAI } from './ai';

function newEngine() {
  return new GameEngine(new GameStore(), new MockAI());
}

describe('GameEngine lobby lifecycle', () => {
  it('creates a game with the host as the first player', () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const game = engine.getGame(gameId);
    expect(game.status).toBe('lobby');
    expect(game.hostId).toBe(hostId);
    expect(game.players).toHaveLength(1);
    expect(game.players[0]).toMatchObject({ id: hostId, name: 'Ada', joinOrder: 0 });
  });

  it('adds joining players in order', () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    const game = engine.getGame(gameId);
    expect(game.players.map((p) => p.name)).toEqual(['Ada', 'Bea', 'Cy']);
    expect(game.players.map((p) => p.joinOrder)).toEqual([0, 1, 2]);
  });

  it('refuses to start a game with fewer than 2 players', () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    expect(() => engine.startGame(gameId, 0)).toThrow('need at least 2 players');
  });

  it('seeds one chain per player on start, each with one pending seed caption', () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.startGame(gameId, 1000);

    const game = engine.getGame(gameId);
    expect(game.status).toBe('active');
    expect(game.chains).toHaveLength(3);

    game.chains.forEach((chain) => {
      expect(chain.steps).toHaveLength(1);
      const seed = chain.steps[0];
      expect(seed).toMatchObject({
        position: 0,
        type: 'caption',
        status: 'pending',
        authorPlayerId: chain.seedPlayerId, // seed player writes caption-index 0
        deadline: 1000 + 60_000,
      });
    });

    // each player seeds exactly one chain
    const seedPlayers = game.chains.map((c) => c.seedPlayerId).sort();
    expect(seedPlayers).toEqual(game.players.map((p) => p.id).sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine`
Expected: FAIL — cannot find module `./engine`.

- [ ] **Step 3: Implement `src/engine/engine.ts` (lobby + start)**

```ts
import type { AIServices } from './ai';
import type { GameStore } from './store';
import type { Chain, Game, Player, Step } from './types';

export class GameEngine {
  private counters: Record<string, number> = {};

  constructor(private store: GameStore, private ai: AIServices) {}

  private id(prefix: string): string {
    this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
    return `${prefix}${this.counters[prefix]}`;
  }

  getGame(gameId: string): Game {
    return this.store.get(gameId);
  }

  createGame(hostName: string, turnDeadlineMs: number, now: number): { gameId: string; hostId: string } {
    const hostId = this.id('p');
    const host: Player = { id: hostId, name: hostName, joinOrder: 0 };
    const game: Game = {
      id: this.id('g'),
      hostId,
      status: 'lobby',
      turnDeadlineMs,
      players: [host],
      chains: [],
      createdAt: now,
    };
    this.store.save(game);
    return { gameId: game.id, hostId };
  }

  joinGame(gameId: string, name: string): { playerId: string } {
    const game = this.store.get(gameId);
    if (game.status !== 'lobby') throw new Error('game already started');
    const playerId = this.id('p');
    game.players.push({ id: playerId, name, joinOrder: game.players.length });
    this.store.save(game);
    return { playerId };
  }

  startGame(gameId: string, now: number): void {
    const game = this.store.get(gameId);
    if (game.status !== 'lobby') throw new Error('game already started');
    if (game.players.length < 2) throw new Error('need at least 2 players');

    game.chains = game.players.map((seedPlayer) => {
      const chain: Chain = {
        id: this.id('c'),
        gameId: game.id,
        seedPlayerId: seedPlayer.id,
        steps: [],
      };
      const seedStep: Step = {
        id: this.id('s'),
        chainId: chain.id,
        position: 0,
        type: 'caption',
        authorPlayerId: seedPlayer.id,
        content: '',
        isAutoFilled: false,
        status: 'pending',
        deadline: now + game.turnDeadlineMs,
      };
      chain.steps.push(seedStep);
      return chain;
    });

    game.status = 'active';
    this.store.save(game);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.test.ts
git commit -m "feat: add GameEngine lobby lifecycle and chain seeding"
```

---

## Task 6: Engine — submit a caption and advance the chain

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/engine/engine.test.ts`

Submitting a caption fills the step, asks the image service to render it (a new
filled image step), and — if the chain has more caption-indices — appends the next
pending caption step assigned to the correct rotated player.

- [ ] **Step 1: Add failing tests**

Append to `src/engine/engine.test.ts`:

```ts
describe('GameEngine caption submission', () => {
  it('lists a player only the caption steps assigned to them', () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);
    const tasks = engine.getPendingTasks(gameId, hostId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].authorPlayerId).toBe(hostId);
  });

  it('fills the caption, generates an image, and opens the next caption', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const { playerId: beaId } = engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    const seedTask = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seedTask.id, 'a cat doing taxes', 5000);

    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    expect(chain.steps).toHaveLength(3);

    expect(chain.steps[0]).toMatchObject({ type: 'caption', status: 'filled', content: 'a cat doing taxes', isAutoFilled: false });
    expect(chain.steps[1]).toMatchObject({ type: 'image', status: 'filled', authorPlayerId: null, content: 'mock-image://a%20cat%20doing%20taxes' });
    // next caption assigned to the next player in rotation (Bea), with a fresh deadline
    expect(chain.steps[2]).toMatchObject({ type: 'caption', status: 'pending', authorPlayerId: beaId, deadline: 5000 + 60_000 });
  });

  it('does not open a new caption once every player has captioned the chain', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const { playerId: beaId } = engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    const chainId = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!.id;

    // caption-index 0 (Ada, seed)
    const t0 = engine.getPendingTasks(gameId, hostId).find((s) => s.chainId === chainId)!;
    await engine.submitCaption(gameId, hostId, t0.id, 'cat', 0);
    // caption-index 1 (Bea) — this is the last for a 2-player game
    const t1 = engine.getPendingTasks(gameId, beaId).find((s) => s.chainId === chainId)!;
    await engine.submitCaption(gameId, beaId, t1.id, 'dog', 0);

    const chain = engine.getGame(gameId).chains.find((c) => c.id === chainId)!;
    expect(chain.steps).toHaveLength(4); // 2 captions + 2 images, no further caption
    expect(chain.steps.filter((s) => s.status === 'pending')).toHaveLength(0);
  });

  it('rejects submitting a caption to a non-pending or non-caption step', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);
    const seedTask = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seedTask.id, 'cat', 0);
    await expect(engine.submitCaption(gameId, hostId, seedTask.id, 'again', 0)).rejects.toThrow('step is not an open caption');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine`
Expected: FAIL — `getPendingTasks`/`submitCaption` are not functions.

- [ ] **Step 3: Add methods to `GameEngine` in `src/engine/engine.ts`**

Add these methods inside the `GameEngine` class (after `startGame`):

```ts
  getPendingTasks(gameId: string, playerId: string): Step[] {
    const game = this.store.get(gameId);
    const tasks: Step[] = [];
    for (const chain of game.chains) {
      for (const step of chain.steps) {
        if (step.type === 'caption' && step.status === 'pending' && step.authorPlayerId === playerId) {
          tasks.push(step);
        }
      }
    }
    return tasks;
  }

  async submitCaption(gameId: string, playerId: string, stepId: string, text: string, now: number): Promise<void> {
    const game = this.store.get(gameId);
    const located = this.locateStep(game, stepId);
    if (!located) throw new Error(`step not found: ${stepId}`);
    const { chain, step } = located;
    if (step.type !== 'caption' || step.status !== 'pending') {
      throw new Error('step is not an open caption');
    }
    if (step.authorPlayerId !== playerId) throw new Error('not your turn');

    step.content = text;
    step.status = 'filled';
    step.isAutoFilled = false;
    step.deadline = null;

    await this.advanceChain(game, chain, step, now);
    this.refreshStatus(game);
    this.store.save(game);
  }

  private locateStep(game: Game, stepId: string): { chain: Chain; step: Step } | null {
    for (const chain of game.chains) {
      const step = chain.steps.find((s) => s.id === stepId);
      if (step) return { chain, step };
    }
    return null;
  }

  private seedIndexOf(game: Game, chain: Chain): number {
    const idx = game.players.findIndex((p) => p.id === chain.seedPlayerId);
    if (idx === -1) throw new Error('seed player not in game');
    return idx;
  }

  // Called after a caption step is filled: render its image, then open the next caption if any remain.
  private async advanceChain(game: Game, chain: Chain, captionStep: Step, now: number): Promise<void> {
    const n = game.players.length;
    const captionIndex = captionStep.position / 2;

    const imageContent = await this.ai.image.generate(captionStep.content);
    const imageStep: Step = {
      id: this.id('s'),
      chainId: chain.id,
      position: captionStep.position + 1,
      type: 'image',
      authorPlayerId: null,
      content: imageContent,
      isAutoFilled: false,
      status: 'filled',
      deadline: null,
    };
    chain.steps.push(imageStep);

    const nextIndex = captionIndex + 1;
    if (nextIndex < n) {
      const seedIndex = this.seedIndexOf(game, chain);
      const author = game.players[(seedIndex + nextIndex) % n];
      chain.steps.push({
        id: this.id('s'),
        chainId: chain.id,
        position: imageStep.position + 1,
        type: 'caption',
        authorPlayerId: author.id,
        content: '',
        isAutoFilled: false,
        status: 'pending',
        deadline: now + game.turnDeadlineMs,
      });
    }
  }

  // Placeholder until Task 9 implements completion; defined here so submit/advance can call it.
  private refreshStatus(_game: Game): void {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine`
Expected: PASS — all engine tests (8 total).

- [ ] **Step 5: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.test.ts
git commit -m "feat: submit captions and advance chains via mock image gen"
```

---

## Task 7: Engine — rotation correctness

**Files:**
- Modify: `src/engine/engine.test.ts`

No new code — this task proves the rotation rule holds by playing a full 3-player
game and asserting each chain is captioned by every player exactly once, seed first.
If it fails, the bug is in `advanceChain`'s author selection (Task 6).

- [ ] **Step 1: Add a failing/regression test**

Append to `src/engine/engine.test.ts`:

```ts
describe('GameEngine rotation', () => {
  it('has each chain captioned by every player exactly once, seed first', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.startGame(gameId, 0);

    const playerIds = engine.getGame(gameId).players.map((p) => p.id);

    // Play every pending caption until none remain.
    let guard = 0;
    while (guard++ < 100) {
      let acted = false;
      for (const pid of playerIds) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-says`, 0);
          acted = true;
        }
      }
      if (!acted) break;
    }

    for (const chain of engine.getGame(gameId).chains) {
      const captionAuthors = chain.steps
        .filter((s) => s.type === 'caption')
        .map((s) => s.authorPlayerId);
      // seed player captions first
      expect(captionAuthors[0]).toBe(chain.seedPlayerId);
      // every player captions the chain exactly once
      expect([...captionAuthors].sort()).toEqual([...playerIds].sort());
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- engine`
Expected: PASS (validates Task 6's rotation). If it FAILS, fix `advanceChain` author math before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/engine/engine.test.ts
git commit -m "test: assert chain rotation visits every player once"
```

---

## Task 8: Engine — deadline auto-fill

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/engine/engine.test.ts`

`processDeadlines(now)` finds pending caption steps whose deadline has passed and
fills them via the AI: seed captions (position 0) use `seedCaption()`; later
captions use `captionForImage()` on the preceding image. Auto-filled steps are
flagged and the chain advances exactly as a human submission would.

- [ ] **Step 1: Add failing tests**

Append to `src/engine/engine.test.ts`:

```ts
describe('GameEngine deadline auto-fill', () => {
  it('does not auto-fill before the deadline', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0); // deadlines at 1000
    await engine.processDeadlines(gameId, 999);
    for (const chain of engine.getGame(gameId).chains) {
      expect(chain.steps[0].status).toBe('pending');
    }
  });

  it('auto-fills an overdue seed caption with an AI seed and advances', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0); // deadlines at 1000

    await engine.processDeadlines(gameId, 2000);

    const chain = engine.getGame(gameId).chains[0];
    expect(chain.steps[0]).toMatchObject({ status: 'filled', isAutoFilled: true });
    expect(chain.steps[0].content.length).toBeGreaterThan(0);
    // chain advanced: image rendered, next caption opened (2-player game => one more)
    expect(chain.steps[1].type).toBe('image');
    expect(chain.steps[2]).toMatchObject({ type: 'caption', status: 'pending' });
  });

  it('auto-fills an overdue non-seed caption from the preceding image', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    // Ada submits her seed on time, opening Bea's caption with deadline 0 + 1000.
    const seed = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seed.id, 'a cat doing taxes', 0);

    // Bea misses the deadline; auto-fill should caption the preceding image.
    await engine.processDeadlines(gameId, 5000);

    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    const beaCaption = chain.steps[2];
    expect(beaCaption).toMatchObject({ type: 'caption', status: 'filled', isAutoFilled: true });
    expect(beaCaption.content).toBe('a drawing of a cat doing taxes');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine`
Expected: FAIL — `processDeadlines` is not a function.

- [ ] **Step 3: Add `processDeadlines` to `GameEngine`**

Add inside the `GameEngine` class (after `submitCaption`):

```ts
  async processDeadlines(gameId: string, now: number): Promise<void> {
    const game = this.store.get(gameId);
    for (const chain of game.chains) {
      // Snapshot pending overdue captions; advanceChain mutates chain.steps as we go.
      const overdue = chain.steps.filter(
        (s) => s.type === 'caption' && s.status === 'pending' && s.deadline !== null && s.deadline <= now,
      );
      for (const step of overdue) {
        step.content = step.position === 0
          ? await this.ai.caption.seedCaption()
          : await this.ai.caption.captionForImage(chain.steps[step.position - 1].content);
        step.status = 'filled';
        step.isAutoFilled = true;
        step.deadline = null;
        await this.advanceChain(game, chain, step, now);
      }
    }
    this.refreshStatus(game);
    this.store.save(game);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine`
Expected: PASS — all engine tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.test.ts
git commit -m "feat: auto-fill overdue captions via AI and advance chains"
```

---

## Task 9: Engine — completion detection and full-game integration

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/engine/engine.test.ts`

Replace the placeholder `refreshStatus` so the game flips to `reveal` once every
chain is complete (`2N` filled steps), and add `isComplete`. Then a full
integration test plays a 4-player game to completion — the proof that the whole
engine works end to end.

- [ ] **Step 1: Add failing tests**

Append to `src/engine/engine.test.ts`:

```ts
describe('GameEngine completion', () => {
  it('flips to reveal and reports complete once all chains are full', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.joinGame(gameId, 'Dee');
    engine.startGame(gameId, 0);

    const n = engine.getGame(gameId).players.length;
    const playerIds = engine.getGame(gameId).players.map((p) => p.id);

    expect(engine.isComplete(gameId)).toBe(false);

    let guard = 0;
    while (!engine.isComplete(gameId) && guard++ < 200) {
      for (const pid of playerIds) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-${task.chainId}`, 0);
        }
      }
    }

    const game = engine.getGame(gameId);
    expect(engine.isComplete(gameId)).toBe(true);
    expect(game.status).toBe('reveal');
    // every chain: 2N steps, all filled, alternating caption/image
    for (const chain of game.chains) {
      expect(chain.steps).toHaveLength(2 * n);
      expect(chain.steps.every((s) => s.status === 'filled')).toBe(true);
      chain.steps.forEach((s, i) => expect(s.type).toBe(i % 2 === 0 ? 'caption' : 'image'));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine`
Expected: FAIL — `isComplete` is not a function (and status stays `active`).

- [ ] **Step 3: Replace the placeholder and add `isComplete`**

In `src/engine/engine.ts`, replace the placeholder `refreshStatus` method:

```ts
  private refreshStatus(game: Game): void {}
```

with:

```ts
  private chainIsComplete(game: Game, chain: Chain): boolean {
    const expected = 2 * game.players.length;
    return chain.steps.length === expected && chain.steps.every((s) => s.status === 'filled');
  }

  private refreshStatus(game: Game): void {
    if (game.status === 'active' && game.chains.every((c) => this.chainIsComplete(game, c))) {
      game.status = 'reveal';
    }
  }

  isComplete(gameId: string): boolean {
    const game = this.store.get(gameId);
    return game.chains.length > 0 && game.chains.every((c) => this.chainIsComplete(game, c));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine`
Expected: PASS — all engine tests including the 4-player integration test.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS — every test file green.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.test.ts
git commit -m "feat: detect game completion and flip to reveal"
```

---

## Task 10: Public engine entry point

**Files:**
- Create: `src/engine/index.ts`
- Test: `src/engine/index.test.ts`

A single import surface so later plans (API routes, UI) import from `./engine`
without reaching into individual files.

- [ ] **Step 1: Write a failing test**

`src/engine/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameEngine, GameStore, MockAI } from './index';

describe('engine public API', () => {
  it('re-exports the engine building blocks', () => {
    const engine = new GameEngine(new GameStore(), new MockAI());
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    expect(engine.getGame(gameId).status).toBe('lobby');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- index`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Create `src/engine/index.ts`**

```ts
export { GameEngine } from './engine';
export { GameStore } from './store';
export { MockAI } from './ai';
export type { AIServices, ImageService, CaptionService } from './ai';
export type { Game, Player, Chain, Step, GameStatus, StepType, StepStatus } from './types';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- index`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all files green.

- [ ] **Step 6: Commit**

```bash
git add src/engine/index.ts src/engine/index.test.ts
git commit -m "feat: add public engine entry point"
```

---

## Done criteria for Plan 1

- `npm test` passes with coverage of: lobby lifecycle, chain seeding, caption
  submission + image rendering, rotation correctness, deadline auto-fill,
  completion detection, and a full multi-player integration game.
- `npm run typecheck` is clean.
- The engine is pure TypeScript with no external dependencies, ready to be imported
  by the Next.js layer in Plan 2.

## What's next (future plans, not this one)

- **Plan 2 — Real AI wrappers:** implement `AIServices` against Google Imagen
  (images) and Claude (vision captions for auto-fill, seed suggestions), behind the
  same interface, with thin integration tests.
- **Plan 3 — Next.js API + web UI:** wrap the engine in API routes, swap the
  in-memory store for Supabase persistence, and build the Lobby / Your-Turn /
  Reveal / Voting screens.
- **Plan 4 — Notifications + deploy:** browser push for "your turn," shareable
  invite/status links, and deployment to Vercel.
```
