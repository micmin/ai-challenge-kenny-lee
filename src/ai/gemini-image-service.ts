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
