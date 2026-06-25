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
    } catch {
      return FALLBACK_CAPTION;
    }
  }

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
