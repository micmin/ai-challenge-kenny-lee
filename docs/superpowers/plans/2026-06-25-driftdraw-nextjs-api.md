# DriftDraw Next.js API Implementation Plan (Plan 3a-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Plan 3a-1 backend library over HTTP via Next.js App Router route handlers, deployable on Vercel, so the game can be created/joined/played to `reveal` through a REST API.

**Architecture:** Split the work into framework-agnostic **handler logic** (parse request → call `GameService` → map errors → `Response`) that is TDD-tested locally with Vitest + fakes, and thin **Next.js route files + scaffolding** that only the `next` build touches (verified by Vercel, since `next`/`react` can't be installed on the corporate-filtered dev machine). Route handlers use the web-standard `Request`/`Response`, so the logic needs no `next` import.

**Tech Stack:** TypeScript (ESM, strict), Vitest, Next.js (App Router) + React. New deps: `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@types/node`.

**Verification model (read this):** The dev laptop's corporate filter blocks `npm install`, so `next`/`react`/`@supabase/supabase-js` are NOT installed locally. Therefore:
- **Tasks 1–2 (handler logic + helpers)** are fully TDD-verifiable locally with `npm test` (they import only web `Request`/`Response`, `GameServicePort` types, and fakes — no `next`/`react`/`supabase`).
- **Tasks 3–4 (Next scaffolding + route glue)** cannot be built locally; they are verified by **Vercel's `next build`**. Local `npm run typecheck` will report errors for the uninstalled packages (this was already true for `wiring.ts` + supabase). That is expected; the green signal for these comes from Vercel.

**Scope note:** Plan 3a-2 of the backend slice (spec `docs/superpowers/specs/2026-06-25-driftdraw-backend-api-design.md`). Out of scope: voting/results and the real UI (Plan 3b — the placeholder page here is a stub), deadline cron + production hardening (Plan 4).

---

## Background the implementer needs

- `src/server/index.ts` exports `createGameService(env) → GameService`, `GameService`, `ConcurrencyError`, `GameView`, `InMemoryGameRepository`.
- `GameService` (in `src/server/game-service.ts`) public methods:
  - `createGame(hostName: string, turnDeadlineMs: number): Promise<{ gameId: string; hostId: string }>`
  - `joinGame(gameId: string, name: string): Promise<{ playerId: string; view: GameView }>`
  - `startGame(gameId: string): Promise<Game>`
  - `submitCaption(gameId: string, playerId: string, stepId: string, text: string): Promise<GameView>`
  - `getState(gameId: string, playerId: string): Promise<GameView>`  (runs lazy `processDeadlines`)
  - `GameView = { game: Game; pendingTasks: Step[] }`
- Engine guard errors (messages): `'Game not found: <id>'`, `'need at least 2 players'`, `'game already started'`, `'not your turn'`, `'game is not active'`, `'step is not an open caption'`. `ConcurrencyError` is thrown when optimistic retries exhaust.
- `GameService` has private fields, so a plain fake object is NOT assignable to the class type. Task 1 adds a `GameServicePort` interface (the 5 public methods) that `GameService` implements and handlers depend on — so tests can pass simple fakes.
- Node 20 + Vitest provide global `Request`/`Response`/`URL`. Handlers return `Response` built with `Response.json(...)` or `new Response(...)`.

---

## File Structure

- `src/server/game-service.ts` — MODIFY: add + implement `GameServicePort` interface.
- `src/server/index.ts` — MODIFY: export `GameServicePort`.
- `src/server/http/responses.ts` — `json()`, `BadRequestError`, `errorToResponse()`.
- `src/server/http/handlers.ts` — the 5 pure handlers (take a `GameServicePort` + request data → `Response`).
- `src/server/http/service.ts` — `getGameService()` lazy singleton (production wiring).
- `src/app/api/games/route.ts` — `POST` create.
- `src/app/api/games/[id]/route.ts` — `GET` state.
- `src/app/api/games/[id]/players/route.ts` — `POST` join.
- `src/app/api/games/[id]/start/route.ts` — `POST` start.
- `src/app/api/games/[id]/captions/route.ts` — `POST` submit caption.
- `src/app/layout.tsx`, `src/app/page.tsx` — minimal root + placeholder page.
- `next.config.mjs`, `next-env.d.ts`, `tsconfig.json` (Next settings), `package.json` (deps + scripts).
- Tests: `src/server/http/responses.test.ts`, `src/server/http/handlers.test.ts`.

---

## Task 1: HTTP response helpers + GameServicePort

**Files:**
- Modify: `src/server/game-service.ts`
- Modify: `src/server/index.ts`
- Create: `src/server/http/responses.ts`
- Test: `src/server/http/responses.test.ts`

- [ ] **Step 1: Add `GameServicePort` to `src/server/game-service.ts`**

Add this interface above the `GameService` class:

```ts
export interface GameServicePort {
  createGame(hostName: string, turnDeadlineMs: number): Promise<{ gameId: string; hostId: string }>;
  joinGame(gameId: string, name: string): Promise<{ playerId: string; view: GameView }>;
  startGame(gameId: string): Promise<Game>;
  submitCaption(gameId: string, playerId: string, stepId: string, text: string): Promise<GameView>;
  getState(gameId: string, playerId: string): Promise<GameView>;
}
```

Change the class declaration to implement it:

```ts
export class GameService implements GameServicePort {
```

- [ ] **Step 2: Export it from `src/server/index.ts`**

Add:

```ts
export type { GameServicePort } from './game-service';
```

- [ ] **Step 3: Write failing tests for the response helpers**

`src/server/http/responses.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { json, BadRequestError, errorToResponse } from './responses';
import { ConcurrencyError } from '../game-service';

describe('json', () => {
  it('serializes a body with a status and JSON content-type', async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('defaults to status 200', () => {
    expect(json({}).status).toBe(200);
  });
});

describe('errorToResponse', () => {
  it('maps BadRequestError to 400', async () => {
    const res = errorToResponse(new BadRequestError('name is required'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'name is required' });
  });

  it('maps a "Game not found" error to 404', () => {
    expect(errorToResponse(new Error('Game not found: g1')).status).toBe(404);
  });

  it('maps ConcurrencyError to 409', () => {
    expect(errorToResponse(new ConcurrencyError('too many')).status).toBe(409);
  });

  it('maps engine guard errors to 409 with their message', async () => {
    const res = errorToResponse(new Error('not your turn'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not your turn' });
  });

  it('maps unknown errors to 500 without leaking the message', async () => {
    const res = errorToResponse(new Error('kaboom internal detail'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal error' });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- responses`
Expected: FAIL — cannot find module `./responses`.

- [ ] **Step 5: Implement `src/server/http/responses.ts`**

```ts
import { ConcurrencyError } from '../game-service';

export class BadRequestError extends Error {}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Engine guard errors that represent a conflict with current game state.
const GAME_RULE_ERRORS = new Set([
  'need at least 2 players',
  'game already started',
  'not your turn',
  'game is not active',
  'step is not an open caption',
]);

export function errorToResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return json({ error: err.message }, 400);
  if (err instanceof ConcurrencyError) return json({ error: 'conflict, please retry' }, 409);
  if (err instanceof Error) {
    if (err.message.startsWith('Game not found')) return json({ error: err.message }, 404);
    if (GAME_RULE_ERRORS.has(err.message)) return json({ error: err.message }, 409);
  }
  return json({ error: 'internal error' }, 500);
}
```

- [ ] **Step 6: Run to verify it passes + full suite**

Run: `npm test -- responses`
Expected: PASS.

Run: `npm test`
Expected: handler/engine/ai/server tests pass; only the pre-existing `wiring.test.ts` remains red (uninstalled `@supabase/supabase-js`).

- [ ] **Step 7: Commit**

```bash
git add src/server/game-service.ts src/server/index.ts src/server/http/responses.ts src/server/http/responses.test.ts
git commit -m "feat: add GameServicePort and HTTP response/error helpers"
```

---

## Task 2: Request handlers

**Files:**
- Create: `src/server/http/handlers.ts`
- Test: `src/server/http/handlers.test.ts`

Pure handlers: each takes a `GameServicePort` plus the route's `gameId` (where applicable) and the `Request`, parses + validates input, calls the service, and returns a `Response`. All errors route through `errorToResponse`.

- [ ] **Step 1: Write failing tests**

`src/server/http/handlers.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  createGameHandler,
  joinGameHandler,
  startGameHandler,
  getStateHandler,
  submitCaptionHandler,
} from './handlers';
import type { GameServicePort } from '../game-service';

function fakeService(overrides: Partial<GameServicePort> = {}): GameServicePort {
  return {
    createGame: vi.fn(async () => ({ gameId: 'g1', hostId: 'p1' })),
    joinGame: vi.fn(async () => ({ playerId: 'p2', view: { game: { id: 'g1' } as any, pendingTasks: [] } })),
    startGame: vi.fn(async () => ({ id: 'g1', status: 'active' } as any)),
    submitCaption: vi.fn(async () => ({ game: { id: 'g1' } as any, pendingTasks: [] })),
    getState: vi.fn(async () => ({ game: { id: 'g1' } as any, pendingTasks: [] })),
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request('http://test', { method: 'POST', body: JSON.stringify(body) });
}

describe('createGameHandler', () => {
  it('creates a game from a valid body', async () => {
    const svc = fakeService();
    const res = await createGameHandler(svc, post({ hostName: 'Ada', turnDeadlineMs: 60000 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ gameId: 'g1', hostId: 'p1' });
    expect(svc.createGame).toHaveBeenCalledWith('Ada', 60000);
  });

  it('rejects a blank hostName with 400', async () => {
    const res = await createGameHandler(fakeService(), post({ hostName: '  ', turnDeadlineMs: 60000 }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive turnDeadlineMs with 400', async () => {
    const res = await createGameHandler(fakeService(), post({ hostName: 'Ada', turnDeadlineMs: 0 }));
    expect(res.status).toBe(400);
  });
});

describe('joinGameHandler', () => {
  it('joins with a valid name', async () => {
    const svc = fakeService();
    const res = await joinGameHandler(svc, 'g1', post({ name: 'Bea' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ playerId: 'p2', view: { game: { id: 'g1' }, pendingTasks: [] } });
    expect(svc.joinGame).toHaveBeenCalledWith('g1', 'Bea');
  });

  it('rejects a blank name with 400', async () => {
    const res = await joinGameHandler(fakeService(), 'g1', post({ name: '' }));
    expect(res.status).toBe(400);
  });

  it('maps a not-found game to 404', async () => {
    const svc = fakeService({ joinGame: vi.fn(async () => { throw new Error('Game not found: g1'); }) });
    const res = await joinGameHandler(svc, 'g1', post({ name: 'Bea' }));
    expect(res.status).toBe(404);
  });
});

describe('startGameHandler', () => {
  it('starts the game and returns it', async () => {
    const svc = fakeService();
    const res = await startGameHandler(svc, 'g1', post({}));
    expect(res.status).toBe(200);
    expect(svc.startGame).toHaveBeenCalledWith('g1');
  });

  it('maps "need at least 2 players" to 409', async () => {
    const svc = fakeService({ startGame: vi.fn(async () => { throw new Error('need at least 2 players'); }) });
    expect((await startGameHandler(svc, 'g1', post({}))).status).toBe(409);
  });
});

describe('getStateHandler', () => {
  it('returns the player-scoped view from the playerId query param', async () => {
    const svc = fakeService();
    const req = new Request('http://test/api/games/g1?playerId=p2');
    const res = await getStateHandler(svc, 'g1', req);
    expect(res.status).toBe(200);
    expect(svc.getState).toHaveBeenCalledWith('g1', 'p2');
  });

  it('rejects a missing playerId with 400', async () => {
    const res = await getStateHandler(fakeService(), 'g1', new Request('http://test/api/games/g1'));
    expect(res.status).toBe(400);
  });
});

describe('submitCaptionHandler', () => {
  it('submits a caption from a valid body', async () => {
    const svc = fakeService();
    const res = await submitCaptionHandler(svc, 'g1', post({ playerId: 'p2', stepId: 's5', text: 'a cat' }));
    expect(res.status).toBe(200);
    expect(svc.submitCaption).toHaveBeenCalledWith('g1', 'p2', 's5', 'a cat');
  });

  it('rejects missing fields with 400', async () => {
    const res = await submitCaptionHandler(fakeService(), 'g1', post({ playerId: 'p2', text: 'a cat' }));
    expect(res.status).toBe(400);
  });

  it('maps "not your turn" to 409', async () => {
    const svc = fakeService({ submitCaption: vi.fn(async () => { throw new Error('not your turn'); }) });
    const res = await submitCaptionHandler(svc, 'g1', post({ playerId: 'p2', stepId: 's5', text: 'x' }));
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- handlers`
Expected: FAIL — cannot find module `./handlers`.

- [ ] **Step 3: Implement `src/server/http/handlers.ts`**

```ts
import type { GameServicePort } from '../game-service';
import { BadRequestError, errorToResponse, json } from './responses';

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    throw new BadRequestError('invalid JSON body');
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`${field} is required`);
  }
  return value;
}

export async function createGameHandler(service: GameServicePort, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const hostName = requireString(body.hostName, 'hostName');
    const turnDeadlineMs = body.turnDeadlineMs;
    if (typeof turnDeadlineMs !== 'number' || turnDeadlineMs <= 0) {
      throw new BadRequestError('turnDeadlineMs must be a positive number');
    }
    return json(await service.createGame(hostName, turnDeadlineMs), 201);
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function joinGameHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const name = requireString(body.name, 'name');
    return json(await service.joinGame(gameId, name));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function startGameHandler(service: GameServicePort, gameId: string, _request: Request): Promise<Response> {
  try {
    return json(await service.startGame(gameId));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function getStateHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const playerId = new URL(request.url).searchParams.get('playerId');
    if (!playerId) throw new BadRequestError('playerId query parameter is required');
    return json(await service.getState(gameId, playerId));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function submitCaptionHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const playerId = requireString(body.playerId, 'playerId');
    const stepId = requireString(body.stepId, 'stepId');
    const text = requireString(body.text, 'text');
    return json(await service.submitCaption(gameId, playerId, stepId, text));
  } catch (err) {
    return errorToResponse(err);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- handlers`
Expected: PASS — all handler tests.

- [ ] **Step 5: Run the full local suite**

Run: `npm test`
Expected: everything green except the pre-existing `wiring.test.ts` (uninstalled supabase). The new `responses` + `handlers` suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/http/handlers.ts src/server/http/handlers.test.ts
git commit -m "feat: add HTTP request handlers for the game API"
```

---

## Task 3: Next.js scaffolding

**Files:**
- Modify: `package.json` (deps + scripts, via npm)
- Modify: `tsconfig.json`
- Create: `next.config.mjs`, `next-env.d.ts`, `src/app/layout.tsx`, `src/app/page.tsx`

> Verified by **Vercel's build**, not locally — `next`/`react` can't be installed here. Local `npm run typecheck` will now report missing-module errors for these files (in addition to the pre-existing supabase one); that is expected. `npm test` (Vitest) is unaffected because it never imports these files.

- [ ] **Step 1: Add Next/React dependencies and scripts**

Run (will fail on the corporate-filtered machine — that's fine; it edits `package.json` either way; Vercel installs them):
`npm install next react react-dom`
then:
`npm install -D @types/react @types/react-dom @types/node`

If the install is blocked, edit `package.json` by hand instead, adding to `dependencies`:
```json
"next": "^15.0.0",
"react": "^19.0.0",
"react-dom": "^19.0.0"
```
and to `devDependencies`:
```json
"@types/node": "^20.0.0",
"@types/react": "^19.0.0",
"@types/react-dom": "^19.0.0"
```
Add these `scripts` to `package.json`:
```json
"dev": "next dev",
"build": "next build",
"start": "next start"
```

- [ ] **Step 2: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 3: Create `next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

- [ ] **Step 4: Update `tsconfig.json` for Next**

Replace `compilerOptions` with the following (keeps strict + the existing target/module style, adds the JSX/DOM/plugin settings Next requires):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "preserve",
    "allowJs": true,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vitest/globals"],
    "plugins": [{ "name": "next" }]
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create `src/app/layout.tsx`** (Next requires a root layout with `<html>`/`<body>`)

```tsx
export const metadata = {
  title: 'DriftDraw',
  description: 'An async multiplayer telephone drawing game.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Create `src/app/page.tsx`** (placeholder until the Plan 3b UI)

```tsx
export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 640 }}>
      <h1>DriftDraw</h1>
      <p>The async multiplayer telephone drawing game. The play UI is coming soon.</p>
      <p>API is live under <code>/api/games</code>.</p>
    </main>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json next.config.mjs next-env.d.ts tsconfig.json src/app/layout.tsx src/app/page.tsx
git commit -m "chore: scaffold Next.js (App Router) for Vercel deployment"
```

(If `package-lock.json` didn't change because the install was blocked, omit it from the `git add`.)

---

## Task 4: Service singleton + route handlers

**Files:**
- Create: `src/server/http/service.ts`
- Create: `src/app/api/games/route.ts`
- Create: `src/app/api/games/[id]/route.ts`
- Create: `src/app/api/games/[id]/players/route.ts`
- Create: `src/app/api/games/[id]/start/route.ts`
- Create: `src/app/api/games/[id]/captions/route.ts`

> Also Vercel-verified. The route files import the (uninstalled-locally) wiring chain via `service.ts`, so they only build on Vercel. They are deliberately trivial — all tested logic lives in `handlers.ts` (Task 2).

- [ ] **Step 1: Create `src/server/http/service.ts`** (lazy singleton so the build doesn't require env)

```ts
import { createGameService, type GameService } from '../index';

let instance: GameService | null = null;

export function getGameService(): GameService {
  if (!instance) instance = createGameService(process.env as Record<string, string | undefined>);
  return instance;
}
```

- [ ] **Step 2: Create `src/app/api/games/route.ts`**

```ts
import { createGameHandler } from '../../../server/http/handlers';
import { getGameService } from '../../../server/http/service';

export async function POST(request: Request): Promise<Response> {
  return createGameHandler(getGameService(), request);
}
```

- [ ] **Step 3: Create `src/app/api/games/[id]/route.ts`**

```ts
import { getStateHandler } from '../../../../server/http/handlers';
import { getGameService } from '../../../../server/http/service';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return getStateHandler(getGameService(), id, request);
}
```

- [ ] **Step 4: Create `src/app/api/games/[id]/players/route.ts`**

```ts
import { joinGameHandler } from '../../../../../server/http/handlers';
import { getGameService } from '../../../../../server/http/service';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return joinGameHandler(getGameService(), id, request);
}
```

- [ ] **Step 5: Create `src/app/api/games/[id]/start/route.ts`**

```ts
import { startGameHandler } from '../../../../../server/http/handlers';
import { getGameService } from '../../../../../server/http/service';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return startGameHandler(getGameService(), id, request);
}
```

- [ ] **Step 6: Create `src/app/api/games/[id]/captions/route.ts`**

```ts
import { submitCaptionHandler } from '../../../../../server/http/handlers';
import { getGameService } from '../../../../../server/http/service';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return submitCaptionHandler(getGameService(), id, request);
}
```

- [ ] **Step 7: Confirm the local logic suite is still green**

Run: `npm test`
Expected: all suites pass except the pre-existing `wiring.test.ts` (uninstalled supabase). The handler/response suites — the locally-verifiable core of this plan — are green.

- [ ] **Step 8: Commit**

```bash
git add src/server/http/service.ts src/app/api
git commit -m "feat: add Next.js route handlers wiring the API to GameService"
```

---

## Task 5: README play section + API notes

**Files:**
- Create or Modify: `README.md`

- [ ] **Step 1: Add a play section + API summary to `README.md`**

```md
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add play section and API summary to README"
```

---

## Done criteria for Plan 3a-2

- **Local:** `npm test` is green for the new `responses` and `handlers` suites (the framework-agnostic API logic), alongside all prior suites; only `wiring.test.ts` remains red due to the uninstalled supabase package.
- **Vercel:** `next build` succeeds (installs all deps, compiles the route handlers + app), and a deployed instance serves `/api/games` and the placeholder homepage.
- The five endpoints behave per the spec, with error mapping (400/404/409/500) verified by the handler tests.

## What's next

- **Plan 3b — Web UI:** Lobby / Your-Turn / Reveal / Voting / Results screens against
  this API, plus voting (engine logic + endpoints), brainstormed visually. Replace
  the placeholder homepage.
- **Plan 4 — Notifications + deploy hardening:** browser push for "your turn,"
  shareable links, deadline cron, custom domain.
