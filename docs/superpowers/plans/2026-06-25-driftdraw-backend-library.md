# DriftDraw Backend Library Implementation Plan (Plan 3a-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic, fully-tested backend for DriftDraw — a `GameService` that persists each game to Supabase (whole-game JSON, optimistic concurrency) and stores generated images in Supabase Storage as URLs — reusing the Plan 1 engine and Plan 2 AI wrappers with two small, backward-compatible touches.

**Architecture:** A `GameService` runs every operation as load → run the in-memory engine → save back, with an optimistic-version retry loop. Persistence and image upload sit behind small injectable ports (`GameRepository`, `ImageUploader`) with in-memory/fake implementations for tests and Supabase implementations for production. The engine gains an optional injected ID generator (so a fresh per-request engine doesn't re-mint existing IDs); the caption service learns to read image URLs. No HTTP/Next.js here — that is Plan 3a-2.

**Tech Stack:** TypeScript (ESM, strict), Vitest. New runtime dep: `@supabase/supabase-js`. Reuses `src/engine` and `src/ai`.

**Scope note:** This is Plan 3a-1 of the backend slice (spec: `docs/superpowers/specs/2026-06-25-driftdraw-backend-api-design.md`). Out of scope: Next.js route handlers, the live Supabase smoke test (both Plan 3a-2), voting/results and all UI (Plan 3b), deadline cron (Plan 4).

---

## Background the implementer needs

- `src/engine/index.ts` exports `GameEngine`, `GameStore`, and types `Game`, `Player`, `Chain`, `Step`, `AIServices`. `GameEngine`'s constructor today is `(store: GameStore, ai: AIServices)`. Its methods: `createGame(hostName, turnDeadlineMs, now) → {gameId, hostId}`, `joinGame(gameId, name) → {playerId}`, `startGame(gameId, now)`, `getPendingTasks(gameId, playerId) → Step[]`, `submitCaption(gameId, playerId, stepId, text, now)`, `processDeadlines(gameId, now)`, `getGame(gameId) → Game`, `isComplete(gameId)`. Time is passed in (`now`), never read internally.
- The engine mints IDs via a per-instance counter; a fresh engine resets it. In a load→run→save model, resuming a game with a fresh engine would re-mint existing IDs (collision). Fix: inject the ID generator (Task 1).
- `Game` is a plain JSON-serializable object (only strings, numbers, booleans, arrays) — it stores directly in a JSONB column; no custom serialization needed.
- `src/ai/index.ts` exports `GeminiImageService`, `PLACEHOLDER_IMAGE`, `ClaudeCaptionService`, `createRealAIServices`, `parseDataUrl`, `toDataUrl`, `MockAI`. `ImageService.generate(caption) → Promise<string>` (a data URL today); `CaptionService.captionForImage(imageContent) → Promise<string>`.
- Supabase facts (verified): `update({...}).eq('id',id).eq('version',v).select()` returns `data: []` when no row matches (→ version conflict); `storage.from(bucket).upload(path, body, {contentType, upsert})` → `{error}`; `storage.from(bucket).getPublicUrl(path)` → `{data: {publicUrl}}` (synchronous).
- `structuredClone`, `crypto.randomUUID`, and `Buffer` are Node built-ins available in this runtime.

---

## File Structure

- `src/engine/engine.ts` — MODIFY: optional injected ID generator (default unchanged).
- `src/engine/index.ts` — MODIFY: export `IdGenerator` type.
- `src/ai/claude-caption-service.ts` — MODIFY: `captionForImage` reads data URLs or `https` URLs.
- `src/server/id-generator.ts` — `uuidIdGenerator`.
- `src/server/game-repository.ts` — `GameRepository` port + `InMemoryGameRepository`.
- `src/server/storage-image-service.ts` — `StorageImageService` (decorator) + `ImageUploader` port.
- `src/server/game-service.ts` — `GameService` (load→run→save + retry), `GameView`, `ConcurrencyError`.
- `src/server/supabase-game-repository.ts` — `SupabaseGameRepository` + minimal `GamesTableClient` port.
- `src/server/supabase-image-uploader.ts` — `SupabaseImageUploader` + minimal `StorageBucketClient` port.
- `src/server/wiring.ts` — `createGameService(env)` factory + `ServerEnv`.
- `src/server/index.ts` — public exports.
- Tests live next to sources as `*.test.ts`.

---

## Task 1: Inject the engine ID generator

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/engine/index.ts`
- Create: `src/server/id-generator.ts`
- Test: `src/server/id-generator.test.ts`
- Modify: `src/engine/engine.test.ts`

- [ ] **Step 1: Add a failing test for injection**

Append to `src/engine/engine.test.ts`:

```ts
describe('GameEngine injected id generator', () => {
  it('uses an injected id generator for new ids', () => {
    // Returns a deterministic id per prefix, so the assertion does not depend on
    // the engine's internal order of id() calls.
    const idgen = (prefix: string) => `${prefix}-X`;
    const engine = new GameEngine(new GameStore(), new MockAI(), idgen);
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    expect(gameId).toBe('g-X'); // game ids use the 'g' prefix
    expect(hostId).toBe('p-X'); // player ids use the 'p' prefix
  });

  it('defaults to the per-prefix counter generator when none is injected (back-compat)', () => {
    const engine = new GameEngine(new GameStore(), new MockAI());
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    expect(gameId).toBe('g1');
    expect(hostId).toBe('p1');
  });
});
```

(`GameEngine`, `GameStore`, and `MockAI` are already imported at the top of this test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- engine`
Expected: FAIL — constructor ignores a third arg / `g#1` !== `g1`.

- [ ] **Step 3: Implement the injection in `src/engine/engine.ts`**

Add this exported type near the top of the file (after the imports):

```ts
export type IdGenerator = (prefix: string) => string;

function createCounterIdGenerator(): IdGenerator {
  const counters: Record<string, number> = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${counters[prefix]}`;
  };
}
```

Then change the class's id state + constructor + `id` method. Replace the existing
`private counters` field and constructor with:

```ts
  private readonly idgen: IdGenerator;

  constructor(
    private store: GameStore,
    private ai: AIServices,
    idGenerator: IdGenerator = createCounterIdGenerator(),
  ) {
    this.idgen = idGenerator;
  }

  private id(prefix: string): string {
    return this.idgen(prefix);
  }
```

(Delete the old `private counters: Record<string, number> = {};` field and the old counter logic inside `id`.)

- [ ] **Step 4: Export the type from `src/engine/index.ts`**

Add to the `export type { ... } from './engine'`-style exports (create the line if needed):

```ts
export type { IdGenerator } from './engine';
```

- [ ] **Step 5: Create `src/server/id-generator.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../engine/index';

// Globally-unique ids so a fresh engine resuming a persisted game never
// re-mints an existing id (the per-request counter would otherwise collide).
export const uuidIdGenerator: IdGenerator = (prefix) => `${prefix}_${randomUUID()}`;
```

- [ ] **Step 6: Create `src/server/id-generator.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { uuidIdGenerator } from './id-generator';

describe('uuidIdGenerator', () => {
  it('prefixes and produces unique ids', () => {
    const a = uuidIdGenerator('s');
    const b = uuidIdGenerator('s');
    expect(a.startsWith('s_')).toBe(true);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test`
Expected: PASS — all engine tests (back-compat preserved) + the new injection and id-generator tests.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/engine/engine.ts src/engine/index.ts src/engine/engine.test.ts src/server/id-generator.ts src/server/id-generator.test.ts
git commit -m "feat: inject engine id generator; add uuid generator for persistence"
```

---

## Task 2: Caption service reads image URLs

**Files:**
- Modify: `src/ai/claude-caption-service.ts`
- Modify: `src/ai/claude-caption-service.test.ts`

Once images live in Storage, `captionForImage` receives an `https://` URL instead
of a data URL. Claude vision accepts a URL image source. Branch: `data:` → base64
block (unchanged); `http(s)://` → URL source; anything else → throw (caught → fallback,
preserving the existing `mock-image://` fallback behavior).

- [ ] **Step 1: Add failing tests**

Append to `src/ai/claude-caption-service.test.ts` (inside the `captionForImage` describe block):

```ts
  it('sends an https URL as a URL image source', async () => {
    const client = clientReplying('a dog in space');
    const svc = new ClaudeCaptionService(client, {});
    const caption = await svc.captionForImage('https://cdn.example.com/img/abc.png');
    expect(caption).toBe('a dog in space');
    const arg = (client.messages.create as any).mock.calls[0][0];
    expect(arg.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://cdn.example.com/img/abc.png' },
    });
  });
```

(The existing test "falls back to a safe caption when the stored content is not a data URL" using `'mock-image://x'` must still pass — `mock-image://` is neither `data:` nor `http(s)://`, so it throws internally and falls back.)

- [ ] **Step 2: Run to verify the new test fails**

Run: `npm test -- claude-caption-service`
Expected: FAIL — `'mock-image://x'`-style handling currently parses as data URL; the https URL produces a base64 attempt or fallback, not a URL source.

- [ ] **Step 3: Update `captionForImage` in `src/ai/claude-caption-service.ts`**

Replace the body of the `try` block in `captionForImage` (the part that builds and sends the request) with:

```ts
      const source = this.imageSource(imageContent);
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source },
              { type: 'text', text: CAPTION_FOR_IMAGE_PROMPT },
            ],
          },
        ],
      });
      return this.firstText(res) ?? FALLBACK_CAPTION;
```

And add this private method to the class:

```ts
  private imageSource(imageContent: string): unknown {
    if (imageContent.startsWith('data:')) {
      const { mediaType, base64 } = parseDataUrl(imageContent);
      return { type: 'base64', media_type: mediaType, data: base64 };
    }
    if (imageContent.startsWith('http://') || imageContent.startsWith('https://')) {
      return { type: 'url', url: imageContent };
    }
    throw new Error('unsupported image reference');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- claude-caption-service`
Expected: PASS — new URL test passes; the data-URL base64 test and the `mock-image://` fallback test still pass.

- [ ] **Step 5: Commit**

```bash
git add src/ai/claude-caption-service.ts src/ai/claude-caption-service.test.ts
git commit -m "feat: caption service accepts https image URLs (Claude URL source)"
```

---

## Task 3: GameRepository port + in-memory implementation

**Files:**
- Create: `src/server/game-repository.ts`
- Test: `src/server/game-repository.test.ts`

The port the `GameService` depends on. `save` returns `false` on a version
mismatch (optimistic-concurrency conflict). `structuredClone` isolates stored
state from caller mutation.

- [ ] **Step 1: Write failing tests**

`src/server/game-repository.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryGameRepository } from './game-repository';
import type { Game } from '../engine/index';

function game(id: string, status: Game['status'] = 'lobby'): Game {
  return { id, hostId: 'p1', status, turnDeadlineMs: 60_000, players: [], chains: [], createdAt: 0 };
}

describe('InMemoryGameRepository', () => {
  it('returns null for an unknown game', async () => {
    expect(await new InMemoryGameRepository().load('nope')).toBeNull();
  });

  it('inserts at version 0 and loads it back', async () => {
    const repo = new InMemoryGameRepository();
    await repo.insert(game('g1'));
    expect(await repo.load('g1')).toEqual({ state: game('g1'), version: 0 });
  });

  it('saves with a matching version and bumps it', async () => {
    const repo = new InMemoryGameRepository();
    await repo.insert(game('g1'));
    const ok = await repo.save('g1', game('g1', 'active'), 0);
    expect(ok).toBe(true);
    expect(await repo.load('g1')).toEqual({ state: game('g1', 'active'), version: 1 });
  });

  it('rejects a save with a stale version', async () => {
    const repo = new InMemoryGameRepository();
    await repo.insert(game('g1'));
    expect(await repo.save('g1', game('g1', 'active'), 5)).toBe(false);
  });

  it('isolates stored state from later caller mutation', async () => {
    const repo = new InMemoryGameRepository();
    const g = game('g1');
    await repo.insert(g);
    g.status = 'done';
    expect((await repo.load('g1'))!.state.status).toBe('lobby');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- game-repository`
Expected: FAIL — cannot find module `./game-repository`.

- [ ] **Step 3: Implement `src/server/game-repository.ts`**

```ts
import type { Game } from '../engine/index';

export interface LoadedGame {
  state: Game;
  version: number;
}

export interface GameRepository {
  load(id: string): Promise<LoadedGame | null>;
  insert(game: Game): Promise<void>;
  /** Returns false when `expectedVersion` no longer matches (concurrency conflict). */
  save(id: string, state: Game, expectedVersion: number): Promise<boolean>;
}

export class InMemoryGameRepository implements GameRepository {
  private rows = new Map<string, LoadedGame>();

  async load(id: string): Promise<LoadedGame | null> {
    const row = this.rows.get(id);
    return row ? { state: structuredClone(row.state), version: row.version } : null;
  }

  async insert(game: Game): Promise<void> {
    this.rows.set(game.id, { state: structuredClone(game), version: 0 });
  }

  async save(id: string, state: Game, expectedVersion: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.version !== expectedVersion) return false;
    this.rows.set(id, { state: structuredClone(state), version: expectedVersion + 1 });
    return true;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- game-repository`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/game-repository.ts src/server/game-repository.test.ts
git commit -m "feat: add GameRepository port and in-memory implementation"
```

---

## Task 4: StorageImageService decorator

**Files:**
- Create: `src/server/storage-image-service.ts`
- Test: `src/server/storage-image-service.test.ts`

Wraps an inner `ImageService` (the real `GeminiImageService`): generate → decode
the data URL → upload bytes via the injected `ImageUploader` → return the public
URL. The placeholder image short-circuits to a configured placeholder URL; an
upload failure also falls back to it (so the chain never breaks).

- [ ] **Step 1: Write failing tests**

`src/server/storage-image-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { StorageImageService, type ImageUploader } from './storage-image-service';
import { PLACEHOLDER_IMAGE } from '../ai/index';
import { toDataUrl } from '../ai/index';
import type { ImageService } from '../engine/index';

const PLACEHOLDER_URL = 'https://cdn.example.com/images/placeholder.png';

function innerReturning(dataUrl: string): ImageService {
  return { generate: vi.fn(async () => dataUrl) };
}

describe('StorageImageService', () => {
  it('uploads the decoded bytes and returns the public URL', async () => {
    const uploaded: { path: string; bytes: Uint8Array; contentType: string }[] = [];
    const uploader: ImageUploader = {
      upload: vi.fn(async (path, bytes, contentType) => {
        uploaded.push({ path, bytes, contentType });
        return `https://cdn.example.com/images/${path}`;
      }),
    };
    let n = 0;
    const svc = new StorageImageService(innerReturning(toDataUrl('image/png', 'QUJD')), uploader, {
      placeholderUrl: PLACEHOLDER_URL,
      newKey: () => `key${++n}`,
    });

    const url = await svc.generate('a cat doing taxes');

    expect(url).toBe('https://cdn.example.com/images/key1.png');
    expect(uploaded[0].contentType).toBe('image/png');
    expect(uploaded[0].path).toBe('key1.png');
    // 'QUJD' base64 decodes to bytes [65,66,67]
    expect(Array.from(uploaded[0].bytes)).toEqual([65, 66, 67]);
  });

  it('returns the placeholder URL when the inner service returns the placeholder image', async () => {
    const uploader: ImageUploader = { upload: vi.fn() };
    const svc = new StorageImageService(innerReturning(PLACEHOLDER_IMAGE), uploader, {
      placeholderUrl: PLACEHOLDER_URL,
    });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_URL);
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder URL when the upload throws', async () => {
    const uploader: ImageUploader = { upload: vi.fn(async () => { throw new Error('storage down'); }) };
    const svc = new StorageImageService(innerReturning(toDataUrl('image/png', 'QUJD')), uploader, {
      placeholderUrl: PLACEHOLDER_URL,
    });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_URL);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- storage-image-service`
Expected: FAIL — cannot find module `./storage-image-service`.

- [ ] **Step 3: Implement `src/server/storage-image-service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { ImageService } from '../engine/index';
import { parseDataUrl, PLACEHOLDER_IMAGE } from '../ai/index';

export interface ImageUploader {
  /** Uploads bytes and returns the public URL. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

export interface StorageImageOptions {
  placeholderUrl: string;
  keyPrefix?: string;
  newKey?: () => string;
}

export class StorageImageService implements ImageService {
  private readonly placeholderUrl: string;
  private readonly keyPrefix: string;
  private readonly newKey: () => string;

  constructor(
    private readonly inner: ImageService,
    private readonly uploader: ImageUploader,
    opts: StorageImageOptions,
  ) {
    this.placeholderUrl = opts.placeholderUrl;
    this.keyPrefix = opts.keyPrefix ?? '';
    this.newKey = opts.newKey ?? (() => randomUUID());
  }

  async generate(caption: string): Promise<string> {
    const dataUrl = await this.inner.generate(caption);
    if (dataUrl === PLACEHOLDER_IMAGE) return this.placeholderUrl;
    try {
      const { mediaType, base64 } = parseDataUrl(dataUrl);
      const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
      const ext = mediaType.split('/')[1] ?? 'png';
      const path = `${this.keyPrefix}${this.newKey()}.${ext}`;
      return await this.uploader.upload(path, bytes, mediaType);
    } catch {
      return this.placeholderUrl;
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- storage-image-service`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/storage-image-service.ts src/server/storage-image-service.test.ts
git commit -m "feat: add StorageImageService decorator (upload + URL, placeholder fallback)"
```

---

## Task 5: GameService (load → run → save + retry)

**Files:**
- Create: `src/server/game-service.ts`
- Test: `src/server/game-service.test.ts`

The orchestration core. `createGame` inserts a new game; every other operation
runs through `mutate`, which loads the game, hydrates a fresh engine (with the
injected UUID generator + injected AI), applies the operation, and saves with the
optimistic-version check — retrying on conflict. Reads that don't change state
(e.g. `processDeadlines` with nothing overdue) skip the save to avoid version churn.

- [ ] **Step 1: Write failing tests**

`src/server/game-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameService, ConcurrencyError } from './game-service';
import { InMemoryGameRepository, type GameRepository, type LoadedGame } from './game-repository';
import { MockAI } from '../ai/index';
import { uuidIdGenerator } from './id-generator';
import type { Game } from '../engine/index';

function newService(repo: GameRepository = new InMemoryGameRepository(), now = () => 0) {
  return new GameService({ repository: repo, ai: new MockAI(), idGenerator: uuidIdGenerator, now });
}

describe('GameService lifecycle', () => {
  it('creates and persists a game', async () => {
    const repo = new InMemoryGameRepository();
    const svc = newService(repo);
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    const loaded = await repo.load(gameId);
    expect(loaded).not.toBeNull();
    expect(loaded!.state.hostId).toBe(hostId);
    expect(loaded!.state.status).toBe('lobby');
  });

  it('joins, starts, and returns the joiner a player-scoped view', async () => {
    const svc = newService();
    const { gameId } = await svc.createGame('Ada', 60_000);
    const { playerId, view } = await svc.joinGame(gameId, 'Bea');
    expect(view.game.players.map((p) => p.name)).toEqual(['Ada', 'Bea']);
    await svc.startGame(gameId);
    const bea = await svc.getState(gameId, playerId);
    expect(bea.pendingTasks).toHaveLength(1); // Bea's seed caption
  });

  it('plays a full 2-player game to reveal through the service', async () => {
    const svc = newService();
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    const { playerId: beaId } = await svc.joinGame(gameId, 'Bea');
    await svc.startGame(gameId);

    let guard = 0;
    let view = await svc.getState(gameId, hostId);
    while (view.game.status !== 'reveal' && guard++ < 50) {
      for (const pid of [hostId, beaId]) {
        const s = await svc.getState(gameId, pid);
        for (const task of s.pendingTasks) {
          view = await svc.submitCaption(gameId, pid, task.id, `${pid}-text`);
        }
      }
      view = await svc.getState(gameId, hostId);
    }
    expect(view.game.status).toBe('reveal');
  });

  it('propagates engine guard errors (not your turn)', async () => {
    const svc = newService();
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    const { playerId: beaId } = await svc.joinGame(gameId, 'Bea');
    await svc.startGame(gameId);
    const adaSeed = (await svc.getState(gameId, hostId)).pendingTasks[0];
    await expect(svc.submitCaption(gameId, beaId, adaSeed.id, 'x')).rejects.toThrow('not your turn');
  });

  it('retries on a version conflict and eventually succeeds', async () => {
    const inner = new InMemoryGameRepository();
    let failNextSave = true;
    const flaky: GameRepository = {
      load: (id) => inner.load(id),
      insert: (g) => inner.insert(g),
      save: async (id, state, version) => {
        if (failNextSave) { failNextSave = false; return false; } // simulate a lost race once
        return inner.save(id, state, version);
      },
    };
    const svc = newService(flaky);
    const { gameId } = await svc.createGame('Ada', 60_000);
    const { view } = await svc.joinGame(gameId, 'Bea'); // first save fails → retry → succeeds
    expect(view.game.players).toHaveLength(2);
  });

  it('throws ConcurrencyError when conflicts never clear', async () => {
    const inner = new InMemoryGameRepository();
    const alwaysConflict: GameRepository = {
      load: (id) => inner.load(id),
      insert: (g) => inner.insert(g),
      save: async () => false,
    };
    const svc = new GameService({
      repository: alwaysConflict, ai: new MockAI(), idGenerator: uuidIdGenerator, now: () => 0, maxRetries: 3,
    });
    const { gameId } = await svc.createGame('Ada', 60_000);
    await expect(svc.joinGame(gameId, 'Bea')).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('skips the save when a read changes nothing (no version churn)', async () => {
    const inner = new InMemoryGameRepository();
    let saves = 0;
    const counting: GameRepository = {
      load: (id) => inner.load(id),
      insert: (g) => inner.insert(g),
      save: (id, state, version) => { saves += 1; return inner.save(id, state, version); },
    };
    const svc = newService(counting);
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    await svc.joinGame(gameId, 'Bea');
    await svc.startGame(gameId);
    const savesBefore = saves;
    await svc.getState(gameId, hostId); // no overdue deadlines → no state change → no save
    expect(saves).toBe(savesBefore);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- game-service`
Expected: FAIL — cannot find module `./game-service`.

- [ ] **Step 3: Implement `src/server/game-service.ts`**

```ts
import { GameEngine, GameStore } from '../engine/index';
import type { AIServices, Game, Step, IdGenerator } from '../engine/index';
import type { GameRepository } from './game-repository';

export class ConcurrencyError extends Error {}

export interface GameServiceDeps {
  repository: GameRepository;
  ai: AIServices;
  idGenerator: IdGenerator;
  now?: () => number;
  maxRetries?: number;
}

export interface GameView {
  game: Game;
  pendingTasks: Step[];
}

export class GameService {
  private readonly now: () => number;
  private readonly maxRetries: number;

  constructor(private readonly deps: GameServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.maxRetries = deps.maxRetries ?? 3;
  }

  private engineFor(state: Game | null): GameEngine {
    const store = new GameStore();
    if (state) store.save(state);
    return new GameEngine(store, this.deps.ai, this.deps.idGenerator);
  }

  async createGame(hostName: string, turnDeadlineMs: number): Promise<{ gameId: string; hostId: string }> {
    const engine = this.engineFor(null);
    const created = engine.createGame(hostName, turnDeadlineMs, this.now());
    await this.deps.repository.insert(engine.getGame(created.gameId));
    return created;
  }

  async joinGame(gameId: string, name: string): Promise<{ playerId: string; view: GameView }> {
    let playerId = '';
    const game = await this.mutate(gameId, (engine) => {
      playerId = engine.joinGame(gameId, name).playerId;
    });
    return { playerId, view: this.viewFor(game, playerId) };
  }

  async startGame(gameId: string): Promise<Game> {
    return this.mutate(gameId, (engine) => {
      engine.startGame(gameId, this.now());
    });
  }

  async submitCaption(gameId: string, playerId: string, stepId: string, text: string): Promise<GameView> {
    const game = await this.mutate(gameId, (engine) =>
      engine.submitCaption(gameId, playerId, stepId, text, this.now()),
    );
    return this.viewFor(game, playerId);
  }

  async getState(gameId: string, playerId: string): Promise<GameView> {
    const game = await this.mutate(gameId, (engine) => engine.processDeadlines(gameId, this.now()));
    return this.viewFor(game, playerId);
  }

  private async mutate(gameId: string, fn: (engine: GameEngine) => void | Promise<void>): Promise<Game> {
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const loaded = await this.deps.repository.load(gameId);
      if (!loaded) throw new Error(`Game not found: ${gameId}`);
      const before = JSON.stringify(loaded.state);
      const engine = this.engineFor(loaded.state);
      await fn(engine);
      const after = engine.getGame(gameId);
      if (JSON.stringify(after) === before) return after; // no change → no write
      if (await this.deps.repository.save(gameId, after, loaded.version)) return after;
    }
    throw new ConcurrencyError(`Too many concurrent updates for game ${gameId}`);
  }

  private viewFor(game: Game, playerId: string): GameView {
    const engine = this.engineFor(game);
    return { game, pendingTasks: engine.getPendingTasks(game.id, playerId) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- game-service`
Expected: PASS — 7 tests, including the full-game, conflict-retry, and no-churn cases.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test`
Expected: PASS — all files.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/game-service.ts src/server/game-service.test.ts
git commit -m "feat: add GameService with load-run-save and optimistic retry"
```

---

## Task 6: Supabase adapters

**Files:**
- Create: `src/server/supabase-game-repository.ts`
- Create: `src/server/supabase-image-uploader.ts`
- Test: `src/server/supabase-game-repository.test.ts`
- Test: `src/server/supabase-image-uploader.test.ts`

Real `GameRepository` and `ImageUploader` implementations against minimal Supabase
client ports. Tested with hand-built fakes that mimic the specific call chains; the
real `SupabaseClient` is cast to these ports at the wiring boundary (Task 7).

- [ ] **Step 1: Write failing tests for the repository**

`src/server/supabase-game-repository.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SupabaseGameRepository, type GamesTableClient } from './supabase-game-repository';
import type { Game } from '../engine/index';

function game(id: string): Game {
  return { id, hostId: 'p1', status: 'lobby', turnDeadlineMs: 60_000, players: [], chains: [], createdAt: 0 };
}

// Builds a fake matching the exact chains the repository uses.
function fakeClient(opts: {
  loaded?: { id: string; state: Game; version: number } | null;
  updateRows?: Array<{ id: string }>;
}): { client: GamesTableClient; calls: any } {
  const calls: any = {};
  const client: GamesTableClient = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: opts.loaded ?? null, error: null }) }),
      }),
      insert: async (row) => { calls.inserted = row; return { error: null }; },
      update: (row) => {
        calls.updated = row;
        return { eq: () => ({ eq: () => ({ select: async () => ({ data: opts.updateRows ?? [], error: null }) }) }) };
      },
    }),
  };
  return { client, calls };
}

describe('SupabaseGameRepository', () => {
  it('loads a row into {state, version}', async () => {
    const { client } = fakeClient({ loaded: { id: 'g1', state: game('g1'), version: 3 } });
    const repo = new SupabaseGameRepository(client);
    expect(await repo.load('g1')).toEqual({ state: game('g1'), version: 3 });
  });

  it('returns null when the row is missing', async () => {
    const { client } = fakeClient({ loaded: null });
    expect(await new SupabaseGameRepository(client).load('g1')).toBeNull();
  });

  it('inserts at version 0', async () => {
    const { client, calls } = fakeClient({});
    await new SupabaseGameRepository(client).insert(game('g1'));
    expect(calls.inserted).toMatchObject({ id: 'g1', version: 0 });
  });

  it('save returns true when a row was updated', async () => {
    const { client } = fakeClient({ updateRows: [{ id: 'g1' }] });
    expect(await new SupabaseGameRepository(client).save('g1', game('g1'), 0)).toBe(true);
  });

  it('save returns false when no row matched the version (conflict)', async () => {
    const { client } = fakeClient({ updateRows: [] });
    expect(await new SupabaseGameRepository(client).save('g1', game('g1'), 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- supabase-game-repository`
Expected: FAIL — cannot find module `./supabase-game-repository`.

- [ ] **Step 3: Implement `src/server/supabase-game-repository.ts`**

```ts
import type { Game } from '../engine/index';
import type { GameRepository, LoadedGame } from './game-repository';

interface GameRow {
  id: string;
  state: Game;
  version: number;
}

// Minimal shape of the Supabase client this repository uses. The real
// SupabaseClient satisfies it structurally; it's cast at the wiring boundary.
export interface GamesTableClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): Promise<{ data: GameRow | null; error: unknown }>;
      };
    };
    insert(row: GameRow): Promise<{ error: unknown }>;
    update(row: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          select(columns: string): Promise<{ data: Array<{ id: string }> | null; error: unknown }>;
        };
      };
    };
  };
}

export class SupabaseGameRepository implements GameRepository {
  constructor(private readonly client: GamesTableClient, private readonly table = 'games') {}

  async load(id: string): Promise<LoadedGame | null> {
    const { data, error } = await this.client.from(this.table).select('id, state, version').eq('id', id).maybeSingle();
    if (error) throw new Error(`load failed: ${String(error)}`);
    return data ? { state: data.state, version: data.version } : null;
  }

  async insert(game: Game): Promise<void> {
    const { error } = await this.client.from(this.table).insert({ id: game.id, state: game, version: 0 });
    if (error) throw new Error(`insert failed: ${String(error)}`);
  }

  async save(id: string, state: Game, expectedVersion: number): Promise<boolean> {
    const { data, error } = await this.client
      .from(this.table)
      .update({ state, version: expectedVersion + 1, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('version', expectedVersion)
      .select('id');
    if (error) throw new Error(`save failed: ${String(error)}`);
    return (data ?? []).length > 0;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- supabase-game-repository`
Expected: PASS — 5 tests.

- [ ] **Step 5: Write failing tests for the uploader**

`src/server/supabase-image-uploader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SupabaseImageUploader, type StorageBucketClient } from './supabase-image-uploader';

function fakeStorage(uploadError: unknown = null): { client: StorageBucketClient; calls: any } {
  const calls: any = {};
  const client: StorageBucketClient = {
    from: (bucket) => {
      calls.bucket = bucket;
      return {
        upload: async (path, body, options) => { calls.upload = { path, body, options }; return { error: uploadError }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn/${calls.bucket}/${path}` } }),
      };
    },
  };
  return { client, calls };
}

describe('SupabaseImageUploader', () => {
  it('uploads with contentType and returns the public URL', async () => {
    const { client, calls } = fakeStorage();
    const uploader = new SupabaseImageUploader(client, 'images');
    const bytes = Uint8Array.from([1, 2, 3]);
    const url = await uploader.upload('key1.png', bytes, 'image/png');
    expect(url).toBe('https://cdn/images/key1.png');
    expect(calls.upload.options).toMatchObject({ contentType: 'image/png' });
    expect(calls.upload.body).toBe(bytes);
  });

  it('throws when the upload errors', async () => {
    const { client } = fakeStorage({ message: 'boom' });
    await expect(new SupabaseImageUploader(client, 'images').upload('k.png', new Uint8Array(), 'image/png'))
      .rejects.toThrow('upload failed');
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- supabase-image-uploader`
Expected: FAIL — cannot find module `./supabase-image-uploader`.

- [ ] **Step 7: Implement `src/server/supabase-image-uploader.ts`**

```ts
import type { ImageUploader } from './storage-image-service';

// Minimal shape of the Supabase Storage client this uploader uses.
export interface StorageBucketClient {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options: { contentType: string; upsert?: boolean },
    ): Promise<{ error: unknown }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
}

export class SupabaseImageUploader implements ImageUploader {
  constructor(private readonly client: StorageBucketClient, private readonly bucket: string) {}

  async upload(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const { error } = await this.client.from(this.bucket).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`upload failed: ${String(error)}`);
    return this.client.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- supabase-image-uploader`
Expected: PASS — 2 tests.

- [ ] **Step 9: Commit**

```bash
git add src/server/supabase-game-repository.ts src/server/supabase-game-repository.test.ts src/server/supabase-image-uploader.ts src/server/supabase-image-uploader.test.ts
git commit -m "feat: add Supabase game repository and image uploader adapters"
```

---

## Task 7: Wiring factory + entry point

**Files:**
- Modify: `package.json` (via npm — add `@supabase/supabase-js`)
- Modify: `.env.example`
- Create: `src/server/wiring.ts`
- Create: `src/server/index.ts`
- Test: `src/server/wiring.test.ts`

Assembles a production `GameService` from environment variables: real Supabase
client, the Plan 2 AI services with the image service wrapped by
`StorageImageService`, and the UUID id generator. Reuses `createRealAIServices`
(which validates the Anthropic/Gemini keys) and wraps only its image service.

- [ ] **Step 1: Install Supabase SDK**

Run: `npm install @supabase/supabase-js`
Expected: added to `dependencies`.

- [ ] **Step 2: Append to `.env.example`**

```
# Supabase (Plan 3a backend)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
# Optional overrides:
# IMAGE_BUCKET=images
# PLACEHOLDER_IMAGE_URL=
```

- [ ] **Step 3: Write failing tests**

`src/server/wiring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGameService } from './wiring';

const full = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
  ANTHROPIC_API_KEY: 'a',
  GEMINI_API_KEY: 'g',
};

describe('createGameService', () => {
  it('throws when SUPABASE_URL is missing', () => {
    const { SUPABASE_URL, ...rest } = full;
    expect(() => createGameService(rest as any)).toThrow('SUPABASE_URL');
  });

  it('throws when SUPABASE_SERVICE_KEY is missing', () => {
    const { SUPABASE_SERVICE_KEY, ...rest } = full;
    expect(() => createGameService(rest as any)).toThrow('SUPABASE_SERVICE_KEY');
  });

  it('throws when an AI key is missing (delegated to createRealAIServices)', () => {
    const { ANTHROPIC_API_KEY, ...rest } = full;
    expect(() => createGameService(rest as any)).toThrow('ANTHROPIC_API_KEY');
  });

  it('builds a GameService when all env is present', () => {
    const svc = createGameService(full);
    expect(typeof svc.createGame).toBe('function');
    expect(typeof svc.submitCaption).toBe('function');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- wiring`
Expected: FAIL — cannot find module `./wiring`.

- [ ] **Step 5: Implement `src/server/wiring.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import { createRealAIServices, StorageImageService } from './ai-reexports';
import type { AIServices } from '../engine/index';
import { GameService } from './game-service';
import { SupabaseGameRepository, type GamesTableClient } from './supabase-game-repository';
import { SupabaseImageUploader, type StorageBucketClient } from './supabase-image-uploader';
import { uuidIdGenerator } from './id-generator';

export interface ServerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  IMAGE_BUCKET?: string;
  PLACEHOLDER_IMAGE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CAPTION_MODEL?: string;
  IMAGE_MODEL?: string;
}

export function createGameService(env: ServerEnv = process.env): GameService {
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL is required');
  if (!env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY is required');

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const bucket = env.IMAGE_BUCKET ?? 'images';
  const placeholderUrl =
    env.PLACEHOLDER_IMAGE_URL ??
    `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/placeholder.png`;

  // Reuse Plan 2's AI services (validates ANTHROPIC/GEMINI keys); wrap only the image service.
  const base = createRealAIServices(env);
  const uploader = new SupabaseImageUploader(supabase as unknown as StorageBucketClient, bucket);
  const ai: AIServices = {
    image: new StorageImageService(base.image, uploader, { placeholderUrl }),
    caption: base.caption,
  };

  const repository = new SupabaseGameRepository(supabase as unknown as GamesTableClient);
  return new GameService({ repository, ai, idGenerator: uuidIdGenerator });
}
```

- [ ] **Step 6: Create `src/server/ai-reexports.ts`** (keeps the wiring import list tidy and avoids a deep relative path repeated across files)

```ts
export { createRealAIServices } from '../ai/index';
export { StorageImageService } from './storage-image-service';
```

- [ ] **Step 7: Create `src/server/index.ts`**

```ts
export { GameService, ConcurrencyError } from './game-service';
export type { GameServiceDeps, GameView } from './game-service';
export { InMemoryGameRepository } from './game-repository';
export type { GameRepository, LoadedGame } from './game-repository';
export { StorageImageService } from './storage-image-service';
export type { ImageUploader, StorageImageOptions } from './storage-image-service';
export { SupabaseGameRepository } from './supabase-game-repository';
export type { GamesTableClient } from './supabase-game-repository';
export { SupabaseImageUploader } from './supabase-image-uploader';
export type { StorageBucketClient } from './supabase-image-uploader';
export { uuidIdGenerator } from './id-generator';
export { createGameService } from './wiring';
export type { ServerEnv } from './wiring';
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npm test -- wiring`
Expected: PASS — 4 tests.

Run: `npm test`
Expected: PASS — entire suite green.

Run: `npm run typecheck`
Expected: clean (confirms the Supabase imports and casts compile).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .env.example src/server/wiring.ts src/server/ai-reexports.ts src/server/index.ts src/server/wiring.test.ts
git commit -m "feat: add createGameService wiring factory and src/server entry point"
```

---

## Done criteria for Plan 3a-1

- `npm test` passes offline (no Supabase/AI keys): id generator, caption URL branch,
  repository, storage image service, the full `GameService` game played through
  load→run→save (including conflict-retry, no-churn, and engine-guard propagation),
  and the Supabase adapters against chain-fakes.
- `npm run typecheck` is clean, including the `@supabase/supabase-js` import and the
  two casts confined to `wiring.ts`.
- `createGameService(process.env)` returns a `GameService` ready for the Next.js
  route handlers in Plan 3a-2.
- Engine and AI changes are backward-compatible (all Plan 1/2 tests still pass).

## What's next

- **Plan 3a-2 — Next.js API surface:** App Router scaffolding (deps, config,
  tsconfig integration verified against the existing Vitest setup), five thin route
  handlers delegating to `createGameService`, handler-level tests, and an env-gated
  live Supabase smoke test (real DB + Storage bucket).
- **Plan 3b — Web UI:** the screens + voting/results, brainstormed visually.
