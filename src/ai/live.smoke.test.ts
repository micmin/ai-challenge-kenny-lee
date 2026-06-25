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
