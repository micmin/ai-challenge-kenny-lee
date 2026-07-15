import type { ImageService } from '../engine/index';
import { toDataUrl } from './data-url';

// Minimal shape this service depends on. The real `GoogleGenAI` instance
// satisfies it structurally (`ai.models.generateContent`). Google's Imagen
// (`generateImages`) models were retired for new accounts; current image
// generation uses a Gemini "Nano Banana" model via `generateContent`, which
// returns the image as an inline-data part.
export interface GenAiImageClient {
  models: {
    generateContent(args: { model: string; contents: string }): Promise<{
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
      }>;
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
    this.model = opts.model ?? 'gemini-2.5-flash-image';
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generate(caption: string): Promise<string> {
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.client.models.generateContent({
          model: this.model,
          contents: caption,
        });
        const parts = res.candidates?.[0]?.content?.parts ?? [];
        const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
        if (inline?.data) {
          return toDataUrl(inline.mimeType ?? 'image/png', inline.data);
        }
        // Response arrived with no image part — usually a content-safety filter
        // or a text-only reply. Log so it isn't silent.
        console.warn(
          `[image] no image in response (attempt ${attempt + 1}/${attempts}); likely a safety filter or text-only reply.`,
        );
      } catch (err) {
        // Thrown errors are typically rate limits / quota / bad model / network.
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`[image] request failed (attempt ${attempt + 1}/${attempts}): ${detail}`);
      }
      if (attempt < this.maxRetries) await this.sleep(200 * (attempt + 1));
    }
    console.warn(`[image] all ${attempts} attempts failed; using placeholder. caption: ${JSON.stringify(caption.slice(0, 120))}`);
    return PLACEHOLDER_IMAGE;
  }
}
