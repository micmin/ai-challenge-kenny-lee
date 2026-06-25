# DriftDraw AI Wrappers Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `AIServices` interface from Plan 1 against real providers — Google Imagen for image generation and Claude (Haiku 4.5, vision) for auto-fill captions — behind the exact same interface the engine already uses, so the engine needs zero changes.

**Architecture:** New `src/ai/` module, separate from `src/engine/`. Each wrapper takes its SDK client via constructor injection so it can be unit-tested with a fake client (no network, no API keys, no cost). A factory wires the real SDK clients from environment variables. Resilience (retries, fallback caption/placeholder image) lives inside the wrappers, so the engine's `advanceChain`/`processDeadlines` stay simple and never throw on a provider hiccup.

**Tech Stack:** TypeScript (ESM, strict), Vitest. New runtime deps: `@anthropic-ai/sdk`, `@google/genai`.

**Scope note:** Plan 2 of ~4. Out of scope: Next.js, Supabase, UI, notifications, and any engine changes. Live API calls are exercised only by an optional, env-gated smoke test (Task 7) — all core tests run offline against fakes.

---

## Background the implementer needs

- Plan 1 built `src/engine/` with this interface (exported from `src/engine/index.ts`):
  ```ts
  interface ImageService { generate(caption: string): Promise<string>; }
  interface CaptionService {
    captionForImage(imageContent: string): Promise<string>;
    seedCaption(): Promise<string>;
  }
  interface AIServices { image: ImageService; caption: CaptionService; }
  ```
- The engine stores whatever `ImageService.generate` returns as a step's `content` (a string), and later passes that same string to `CaptionService.captionForImage`. **The shared convention:** `generate` returns a `data:<mediaType>;base64,<data>` URL; `captionForImage` parses that URL back into base64 to send Claude a vision request. (The mock used `mock-image://…`; we swap the convention to real data URLs.)
- **Claude can't generate images** — images come from Google Imagen; Claude only reads them (vision) to write captions.
- Provider facts (verified current):
  - Images — `@google/genai`: `new GoogleGenAI({ apiKey })`, then `await ai.models.generateImages({ model: 'imagen-4.0-generate-001', prompt, config: { numberOfImages: 1 } })`; base64 is at `response.generatedImages[0].image.imageBytes` (mime at `.image.mimeType`, usually `image/png`).
  - Captions — `@anthropic-ai/sdk`: `new Anthropic({ apiKey })`, then `client.messages.create({ model: 'claude-haiku-4-5', max_tokens, messages: [{ role: 'user', content: [ { type: 'image', source: { type: 'base64', media_type, data } }, { type: 'text', text } ] }] })`; the reply text is the first `content` block with `type === 'text'`. Haiku needs no `thinking`/`effort` params — omit them.

---

## File Structure

- `src/ai/data-url.ts` — `toDataUrl` / `parseDataUrl` helpers (the image↔caption string convention).
- `src/ai/gemini-image-service.ts` — `GeminiImageService implements ImageService`, injected GenAI client, retry + placeholder fallback. Also exports the minimal `GenAiImageClient` interface it depends on.
- `src/ai/claude-caption-service.ts` — `ClaudeCaptionService implements CaptionService`, injected Anthropic-like client, fallback caption/seed. Exports the minimal `ClaudeMessagesClient` interface and the prompt constants.
- `src/ai/real-ai-services.ts` — `createRealAIServices(env)` factory: validates env, builds real SDK clients, returns `AIServices`.
- `src/ai/index.ts` — public exports for `src/ai/`.
- `.env.example` — documents the two required keys.
- Test files live next to their source as `*.test.ts`.

---

## Task 1: Add dependencies and env example

**Files:**
- Modify: `package.json` (via npm)
- Create: `.env.example`

- [ ] **Step 1: Install the two runtime SDKs**

Run: `npm install @anthropic-ai/sdk @google/genai`
Expected: both added to `dependencies` in `package.json`; `npm install` completes without errors.

- [ ] **Step 2: Create `.env.example`**

```
# DriftDraw API keys (copy to .env, never commit .env)
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
# Optional overrides:
# CAPTION_MODEL=claude-haiku-4-5
# IMAGE_MODEL=imagen-4.0-generate-001
```

- [ ] **Step 3: Verify the project still typechecks and tests pass**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all existing Plan 1 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Anthropic + Google GenAI SDKs and env example"
```

---

## Task 2: Data-URL helpers

**Files:**
- Create: `src/ai/data-url.ts`
- Test: `src/ai/data-url.test.ts`

- [ ] **Step 1: Write failing tests**

`src/ai/data-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toDataUrl, parseDataUrl } from './data-url';

describe('data-url helpers', () => {
  it('builds a base64 data URL', () => {
    expect(toDataUrl('image/png', 'QUJD')).toBe('data:image/png;base64,QUJD');
  });

  it('round-trips a data URL', () => {
    const url = toDataUrl('image/jpeg', 'Zm9v');
    expect(parseDataUrl(url)).toEqual({ mediaType: 'image/jpeg', base64: 'Zm9v' });
  });

  it('parses base64 payloads that contain "+", "/", and "="', () => {
    const url = toDataUrl('image/png', 'a+b/c==');
    expect(parseDataUrl(url)).toEqual({ mediaType: 'image/png', base64: 'a+b/c==' });
  });

  it('throws on a non-base64 data URL', () => {
    expect(() => parseDataUrl('mock-image://nope')).toThrow('not a base64 data URL');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- data-url`
Expected: FAIL — cannot find module `./data-url`.

- [ ] **Step 3: Implement `src/ai/data-url.ts`**

```ts
export interface ParsedDataUrl {
  mediaType: string;
  base64: string;
}

export function toDataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

export function parseDataUrl(value: string): ParsedDataUrl {
  const match = value.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) throw new Error('not a base64 data URL');
  return { mediaType: match[1], base64: match[2] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- data-url`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ai/data-url.ts src/ai/data-url.test.ts
git commit -m "feat: add data-URL helpers for the image/caption convention"
```

---

## Task 3: Gemini image service

**Files:**
- Create: `src/ai/gemini-image-service.ts`
- Test: `src/ai/gemini-image-service.test.ts`

The wrapper owns its resilience: it retries transient failures and, if image
generation ultimately fails or returns nothing, returns a 1×1 placeholder data
URL instead of throwing — so the engine's chain always advances. The `sleep`
function is injectable so tests don't actually wait between retries.

- [ ] **Step 1: Write failing tests**

`src/ai/gemini-image-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { GeminiImageService, PLACEHOLDER_IMAGE, type GenAiImageClient } from './gemini-image-service';

const noSleep = async () => {};

function clientReturning(imageBytes: string | undefined, mimeType?: string): GenAiImageClient {
  return {
    models: {
      generateImages: vi.fn(async () => ({
        generatedImages: [{ image: imageBytes === undefined ? {} : { imageBytes, mimeType } }],
      })),
    },
  };
}

describe('GeminiImageService', () => {
  it('returns a data URL built from the generated base64 + mime', async () => {
    const svc = new GeminiImageService(clientReturning('QUJD', 'image/png'), { sleep: noSleep });
    expect(await svc.generate('a cat doing taxes')).toBe('data:image/png;base64,QUJD');
  });

  it('defaults the mime type to image/png when the SDK omits it', async () => {
    const svc = new GeminiImageService(clientReturning('QUJD'), { sleep: noSleep });
    expect(await svc.generate('x')).toBe('data:image/png;base64,QUJD');
  });

  it('passes the caption as the prompt and the configured model', async () => {
    const client = clientReturning('QUJD', 'image/png');
    const svc = new GeminiImageService(client, { model: 'imagen-test', sleep: noSleep });
    await svc.generate('a dog astronaut');
    expect(client.models.generateImages).toHaveBeenCalledWith({
      model: 'imagen-test',
      prompt: 'a dog astronaut',
      config: { numberOfImages: 1 },
    });
  });

  it('retries on a thrown error and succeeds within maxRetries', async () => {
    let calls = 0;
    const client: GenAiImageClient = {
      models: {
        generateImages: vi.fn(async () => {
          calls += 1;
          if (calls < 3) throw new Error('transient');
          return { generatedImages: [{ image: { imageBytes: 'QUJD', mimeType: 'image/png' } }] };
        }),
      },
    };
    const svc = new GeminiImageService(client, { maxRetries: 2, sleep: noSleep });
    expect(await svc.generate('x')).toBe('data:image/png;base64,QUJD');
    expect(calls).toBe(3);
  });

  it('falls back to the placeholder image when every attempt throws', async () => {
    const client: GenAiImageClient = {
      models: { generateImages: vi.fn(async () => { throw new Error('boom'); }) },
    };
    const svc = new GeminiImageService(client, { maxRetries: 2, sleep: noSleep });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_IMAGE);
    expect(client.models.generateImages).toHaveBeenCalledTimes(3);
  });

  it('falls back to the placeholder when the SDK returns no image bytes', async () => {
    const svc = new GeminiImageService(clientReturning(undefined), { maxRetries: 1, sleep: noSleep });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_IMAGE);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- gemini-image-service`
Expected: FAIL — cannot find module `./gemini-image-service`.

- [ ] **Step 3: Implement `src/ai/gemini-image-service.ts`**

```ts
import type { ImageService } from '../engine/index';
import { toDataUrl } from './data-url';

// Minimal shape this service depends on. The real `GoogleGenAI` instance
// satisfies it structurally (`ai.models.generateImages`).
export interface GenAiImageClient {
  models: {
    generateImages(args: {
      model: string;
      prompt: string;
      config?: { numberOfImages?: number };
    }): Promise<{
      generatedImages?: Array<{ image?: { imageBytes?: string; mimeType?: string } }>;
    }>;
  };
}

export interface GeminiImageOptions {
  model?: string;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

// 1×1 PNG, returned when generation fails so the chain still advances.
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
export const PLACEHOLDER_IMAGE = toDataUrl('image/png', PLACEHOLDER_PNG_BASE64);

export class GeminiImageService implements ImageService {
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly client: GenAiImageClient, opts: GeminiImageOptions = {}) {
    this.model = opts.model ?? 'imagen-4.0-generate-001';
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generate(caption: string): Promise<string> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.client.models.generateImages({
          model: this.model,
          prompt: caption,
          config: { numberOfImages: 1 },
        });
        const image = res.generatedImages?.[0]?.image;
        if (image?.imageBytes) {
          return toDataUrl(image.mimeType ?? 'image/png', image.imageBytes);
        }
      } catch {
        // fall through to retry/backoff below
      }
      if (attempt < this.maxRetries) await this.sleep(200 * (attempt + 1));
    }
    return PLACEHOLDER_IMAGE;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- gemini-image-service`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ai/gemini-image-service.ts src/ai/gemini-image-service.test.ts
git commit -m "feat: add GeminiImageService with retry and placeholder fallback"
```

---

## Task 4: Claude caption service

**Files:**
- Create: `src/ai/claude-caption-service.ts`
- Test: `src/ai/claude-caption-service.test.ts`

`captionForImage` parses the data URL and sends Claude a vision request;
`seedCaption` asks Claude for a fresh prompt. Both fall back to safe defaults on
any error so the engine never breaks. The prompt constants
(`CAPTION_FOR_IMAGE_PROMPT`, `SEED_PROMPT`) are the main creative lever — they
decide how human and playful the AI's captions feel.

- [ ] **Step 1: Write failing tests**

`src/ai/claude-caption-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  ClaudeCaptionService,
  FALLBACK_CAPTION,
  type ClaudeMessagesClient,
} from './claude-caption-service';
import { toDataUrl } from './data-url';

function clientReplying(text: string | undefined): ClaudeMessagesClient {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: text === undefined ? [] : [{ type: 'text', text }],
      })),
    },
  };
}

describe('ClaudeCaptionService.captionForImage', () => {
  it('sends the image as a base64 block and returns the trimmed caption', async () => {
    const client = clientReplying('  a cat filing a 1040 form  ');
    const svc = new ClaudeCaptionService(client, { model: 'claude-haiku-4-5' });
    const url = toDataUrl('image/png', 'QUJD');

    const caption = await svc.captionForImage(url);

    expect(caption).toBe('a cat filing a 1040 form');
    const arg = (client.messages.create as any).mock.calls[0][0];
    expect(arg.model).toBe('claude-haiku-4-5');
    expect(arg.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
    });
    expect(arg.messages[0].content[1].type).toBe('text');
  });

  it('falls back to a safe caption when Claude returns no text', async () => {
    const svc = new ClaudeCaptionService(clientReplying(undefined), {});
    expect(await svc.captionForImage(toDataUrl('image/png', 'QUJD'))).toBe(FALLBACK_CAPTION);
  });

  it('falls back to a safe caption when the request throws', async () => {
    const client: ClaudeMessagesClient = {
      messages: { create: vi.fn(async () => { throw new Error('429'); }) },
    };
    const svc = new ClaudeCaptionService(client, {});
    expect(await svc.captionForImage(toDataUrl('image/png', 'QUJD'))).toBe(FALLBACK_CAPTION);
  });

  it('falls back to a safe caption when the stored content is not a data URL', async () => {
    const svc = new ClaudeCaptionService(clientReplying('ignored'), {});
    expect(await svc.captionForImage('mock-image://x')).toBe(FALLBACK_CAPTION);
  });
});

describe('ClaudeCaptionService.seedCaption', () => {
  it('returns Claude’s seed text when available', async () => {
    const svc = new ClaudeCaptionService(clientReplying('a penguin running a startup'), {});
    expect(await svc.seedCaption()).toBe('a penguin running a startup');
  });

  it('falls back to a non-empty seed when the request fails', async () => {
    const client: ClaudeMessagesClient = {
      messages: { create: vi.fn(async () => { throw new Error('boom'); }) },
    };
    const svc = new ClaudeCaptionService(client, {});
    const seed = await svc.seedCaption();
    expect(typeof seed).toBe('string');
    expect(seed.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- claude-caption-service`
Expected: FAIL — cannot find module `./claude-caption-service`.

- [ ] **Step 3: Implement `src/ai/claude-caption-service.ts`**

```ts
import type { CaptionService } from '../engine/index';
import { parseDataUrl } from './data-url';

// Minimal shape this service depends on. The real Anthropic client satisfies it
// structurally (`client.messages.create`). `content` is left loose on purpose so
// both a fake and the real SDK client are assignable.
export interface ClaudeMessagesClient {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: 'user'; content: unknown }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface ClaudeCaptionOptions {
  model?: string;
}

export const FALLBACK_CAPTION = 'a mysterious scene';

const FALLBACK_SEEDS = [
  'a cat doing taxes',
  'a dog astronaut',
  'a robot baking bread',
  'a penguin surfing',
];

// --- Creative levers: these prompts decide how human/playful captions feel. ---
export const CAPTION_FOR_IMAGE_PROMPT =
  'You are playing a party game. Look at this image and write a single short caption ' +
  'describing what you see — natural, specific, and a little playful, the way a player ' +
  'would when guessing. One sentence, lowercase, no quotation marks, no preamble. ' +
  'Reply with only the caption.';

export const SEED_PROMPT =
  'You are playing a party drawing game. Invent ONE short, absurd, vivid scene to draw, ' +
  "like 'a cat doing taxes'. Reply with only the phrase: lowercase, no quotes, no preamble, " +
  'at most 8 words.';
// ------------------------------------------------------------------------------

export class ClaudeCaptionService implements CaptionService {
  private readonly model: string;
  private seedIndex = 0;

  constructor(private readonly client: ClaudeMessagesClient, opts: ClaudeCaptionOptions = {}) {
    this.model = opts.model ?? 'claude-haiku-4-5';
  }

  async captionForImage(imageContent: string): Promise<string> {
    try {
      const { mediaType, base64 } = parseDataUrl(imageContent);
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: CAPTION_FOR_IMAGE_PROMPT },
            ],
          },
        ],
      });
      return this.firstText(res) ?? FALLBACK_CAPTION;
    } catch {
      return FALLBACK_CAPTION;
    }
  }

  async seedCaption(): Promise<string> {
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 60,
        messages: [{ role: 'user', content: SEED_PROMPT }],
      });
      return this.firstText(res) ?? this.nextFallbackSeed();
    } catch {
      return this.nextFallbackSeed();
    }
  }

  private firstText(res: { content: Array<{ type: string; text?: string }> }): string | null {
    const block = res.content.find((b) => b.type === 'text' && typeof b.text === 'string');
    const text = block?.text?.trim();
    return text ? text : null;
  }

  private nextFallbackSeed(): string {
    const seed = FALLBACK_SEEDS[this.seedIndex % FALLBACK_SEEDS.length];
    this.seedIndex += 1;
    return seed;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- claude-caption-service`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ai/claude-caption-service.ts src/ai/claude-caption-service.test.ts
git commit -m "feat: add ClaudeCaptionService (vision auto-fill + seed prompts)"
```

---

## Task 5: Real AI services factory + entry point

**Files:**
- Create: `src/ai/real-ai-services.ts`
- Create: `src/ai/index.ts`
- Test: `src/ai/real-ai-services.test.ts`

The factory validates env, builds the real SDK clients, and returns an
`AIServices` the engine can use directly. The real SDK types are broader than our
minimal client interfaces, so we cast at the boundary (the only place a cast is
acceptable — the wrappers themselves stay fully typed).

- [ ] **Step 1: Write failing tests**

`src/ai/real-ai-services.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRealAIServices } from './real-ai-services';

describe('createRealAIServices', () => {
  it('throws a clear error when ANTHROPIC_API_KEY is missing', () => {
    expect(() => createRealAIServices({ GEMINI_API_KEY: 'g' })).toThrow('ANTHROPIC_API_KEY');
  });

  it('throws a clear error when GEMINI_API_KEY is missing', () => {
    expect(() => createRealAIServices({ ANTHROPIC_API_KEY: 'a' })).toThrow('GEMINI_API_KEY');
  });

  it('builds an AIServices with image and caption when both keys are present', () => {
    const ai = createRealAIServices({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    expect(typeof ai.image.generate).toBe('function');
    expect(typeof ai.caption.captionForImage).toBe('function');
    expect(typeof ai.caption.seedCaption).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- real-ai-services`
Expected: FAIL — cannot find module `./real-ai-services`.

- [ ] **Step 3: Implement `src/ai/real-ai-services.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { AIServices } from '../engine/index';
import { GeminiImageService, type GenAiImageClient } from './gemini-image-service';
import { ClaudeCaptionService, type ClaudeMessagesClient } from './claude-caption-service';

export interface RealAIEnv {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CAPTION_MODEL?: string;
  IMAGE_MODEL?: string;
}

export function createRealAIServices(env: RealAIEnv = process.env): AIServices {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  return {
    // The SDK clients are broader than our minimal interfaces; cast at this boundary only.
    image: new GeminiImageService(genai as unknown as GenAiImageClient, { model: env.IMAGE_MODEL }),
    caption: new ClaudeCaptionService(anthropic as unknown as ClaudeMessagesClient, {
      model: env.CAPTION_MODEL ?? 'claude-haiku-4-5',
    }),
  };
}
```

- [ ] **Step 4: Create `src/ai/index.ts`**

```ts
export { GeminiImageService, PLACEHOLDER_IMAGE } from './gemini-image-service';
export type { GenAiImageClient, GeminiImageOptions } from './gemini-image-service';
export {
  ClaudeCaptionService,
  FALLBACK_CAPTION,
  CAPTION_FOR_IMAGE_PROMPT,
  SEED_PROMPT,
} from './claude-caption-service';
export type { ClaudeMessagesClient, ClaudeCaptionOptions } from './claude-caption-service';
export { createRealAIServices } from './real-ai-services';
export type { RealAIEnv } from './real-ai-services';
export { toDataUrl, parseDataUrl } from './data-url';
export type { ParsedDataUrl } from './data-url';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- real-ai-services`
Expected: PASS — 3 tests.

Run: `npm run typecheck`
Expected: no errors (confirms the casts and SDK imports compile).

- [ ] **Step 6: Commit**

```bash
git add src/ai/real-ai-services.ts src/ai/index.ts src/ai/real-ai-services.test.ts
git commit -m "feat: add createRealAIServices factory and src/ai entry point"
```

---

## Task 6: Prove the real wrappers satisfy the engine contract (offline)

**Files:**
- Create: `src/ai/engine-integration.test.ts`

Proves the real wrapper classes satisfy the engine's `AIServices` contract and
that a full game runs end-to-end against them — still offline, by injecting fake
SDK clients into the real wrapper classes (not the Plan 1 mock). This is the test
that would catch any drift between the interface and the wrappers.

- [ ] **Step 1: Write the test**

`src/ai/engine-integration.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { GameEngine, GameStore, type AIServices } from '../engine/index';
import { GeminiImageService, type GenAiImageClient } from './gemini-image-service';
import { ClaudeCaptionService, type ClaudeMessagesClient } from './claude-caption-service';
import { toDataUrl } from './data-url';

function fakeAI(): AIServices {
  const genai: GenAiImageClient = {
    models: {
      generateImages: vi.fn(async () => ({
        generatedImages: [{ image: { imageBytes: 'QUJD', mimeType: 'image/png' } }],
      })),
    },
  };
  const claude: ClaudeMessagesClient = {
    messages: {
      create: vi.fn(async () => ({ content: [{ type: 'text', text: 'a drawing of something' }] })),
    },
  };
  return {
    image: new GeminiImageService(genai, { sleep: async () => {} }),
    caption: new ClaudeCaptionService(claude, {}),
  };
}

describe('real wrappers satisfy the engine contract', () => {
  it('plays a full 3-player game to reveal using the real wrapper classes', async () => {
    const engine = new GameEngine(new GameStore(), fakeAI());
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.startGame(gameId, 0);

    const playerIds = engine.getGame(gameId).players.map((p) => p.id);
    let guard = 0;
    while (!engine.isComplete(gameId) && guard++ < 200) {
      for (const pid of playerIds) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-says`, 0);
        }
      }
    }

    const game = engine.getGame(gameId);
    expect(engine.isComplete(gameId)).toBe(true);
    expect(game.status).toBe('reveal');
    // image steps now hold real data URLs produced by GeminiImageService
    const imageStep = game.chains[0].steps.find((s) => s.type === 'image')!;
    expect(imageStep.content).toBe(toDataUrl('image/png', 'QUJD'));
  });

  it('auto-fills a missed caption from the preceding image via ClaudeCaptionService', async () => {
    const engine = new GameEngine(new GameStore(), fakeAI());
    const { gameId, hostId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    const seed = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seed.id, 'a cat doing taxes', 0);
    await engine.processDeadlines(gameId, 5000); // Bea misses her turn

    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    const beaCaption = chain.steps[2];
    expect(beaCaption).toMatchObject({ type: 'caption', status: 'filled', isAutoFilled: true });
    expect(beaCaption.content).toBe('a drawing of something');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- engine-integration`
Expected: PASS — 2 tests.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm test`
Expected: PASS — all files green.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ai/engine-integration.test.ts
git commit -m "test: prove real AI wrappers satisfy the engine contract offline"
```

---

## Task 7: Optional live smoke test (env-gated, skipped by default)

**Files:**
- Create: `src/ai/live.smoke.test.ts`

A real, money-spending check that only runs when both API keys are present.
`describe.skipIf` keeps CI and offline runs green. Run it manually after setting
`.env` to confirm real Imagen + Claude calls work.

- [ ] **Step 1: Write the gated test**

`src/ai/live.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRealAIServices } from './real-ai-services';
import { parseDataUrl } from './data-url';

const hasKeys = Boolean(process.env.ANTHROPIC_API_KEY && process.env.GEMINI_API_KEY);

describe.skipIf(!hasKeys)('live AI smoke test (requires real API keys)', () => {
  it('generates a real image and captions it', async () => {
    const ai = createRealAIServices(process.env);
    const url = await ai.image.generate('a cat doing taxes, cartoon style');
    const { mediaType, base64 } = parseDataUrl(url);
    expect(mediaType.startsWith('image/')).toBe(true);
    expect(base64.length).toBeGreaterThan(100);

    const caption = await ai.caption.captionForImage(url);
    expect(typeof caption).toBe('string');
    expect(caption.length).toBeGreaterThan(0);

    const seed = await ai.caption.seedCaption();
    expect(seed.length).toBeGreaterThan(0);
  }, 60_000);
});
```

- [ ] **Step 2: Confirm it is skipped without keys**

Run: `npm test -- live.smoke`
Expected: the suite is reported as skipped (0 failures) when no keys are set.

- [ ] **Step 3: Commit**

```bash
git add src/ai/live.smoke.test.ts
git commit -m "test: add env-gated live AI smoke test (skipped without keys)"
```

---

## Done criteria for Plan 2

- `npm test` passes offline (no API keys needed): data-URL helpers, both wrappers
  (success + retry + fallback paths), the factory's env validation, and a full
  engine game driven by the real wrapper classes with injected fake SDK clients.
- `npm run typecheck` is clean, including the real SDK imports.
- `createRealAIServices(process.env)` returns an `AIServices` the engine can use
  with zero engine changes.
- Optionally, with `.env` populated, `npm test -- live.smoke` makes real Imagen +
  Claude calls and passes.

## What's next (future plans)

- **Plan 3 — Next.js API + web UI:** wrap the engine + real AI services in API
  routes, swap the in-memory store for Supabase, and build the Lobby / Your-Turn /
  Reveal / Voting screens. Note: large base64 data URLs are fine in memory but
  should be uploaded to storage (returning a URL) once Supabase lands.
- **Plan 4 — Notifications + deploy:** browser push for "your turn," shareable
  links, Vercel deployment.
```
