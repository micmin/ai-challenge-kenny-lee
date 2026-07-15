import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiImageService, PLACEHOLDER_IMAGE, type GenAiImageClient } from './gemini-image-service';
import { parseDataUrl } from './data-url';

const noSleep = async () => {};

// The service logs warnings on retry/fallback paths; keep test output pristine.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// A fake client whose generateContent returns one image part, or a text-only
// part when imageBytes is undefined (simulating a safety-filtered response).
function clientReturning(imageBytes: string | undefined, mimeType?: string): GenAiImageClient {
  return {
    models: {
      generateContent: vi.fn(async () => ({
        candidates: [
          {
            content: {
              parts:
                imageBytes === undefined
                  ? [{ text: 'no image here' }]
                  : [{ inlineData: { data: imageBytes, mimeType } }],
            },
          },
        ],
      })),
    },
  };
}

describe('GeminiImageService', () => {
  it('returns a data URL built from the generated base64 + mime', async () => {
    const svc = new GeminiImageService(clientReturning('QUJD', 'image/png'), { sleep: noSleep });
    expect(await svc.generate('a cat doing taxes')).toBe('data:image/png;base64,QUJD');
  });

  it('defaults the mime type to image/png when the model omits it', async () => {
    const svc = new GeminiImageService(clientReturning('QUJD'), { sleep: noSleep });
    expect(await svc.generate('x')).toBe('data:image/png;base64,QUJD');
  });

  it('passes the caption as contents and the configured model', async () => {
    const client = clientReturning('QUJD', 'image/png');
    const svc = new GeminiImageService(client, { model: 'test-image-model', sleep: noSleep });
    await svc.generate('a dog astronaut');
    expect(client.models.generateContent).toHaveBeenCalledWith({
      model: 'test-image-model',
      contents: 'a dog astronaut',
    });
  });

  it('defaults to the gemini-2.5-flash-image model', async () => {
    const client = clientReturning('QUJD', 'image/png');
    const svc = new GeminiImageService(client, { sleep: noSleep });
    await svc.generate('x');
    expect(client.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash-image' }),
    );
  });

  it('retries on a thrown error and succeeds within maxRetries', async () => {
    let calls = 0;
    const client: GenAiImageClient = {
      models: {
        generateContent: vi.fn(async () => {
          calls += 1;
          if (calls < 3) throw new Error('transient');
          return { candidates: [{ content: { parts: [{ inlineData: { data: 'QUJD', mimeType: 'image/png' } }] } }] };
        }),
      },
    };
    const svc = new GeminiImageService(client, { maxRetries: 2, sleep: noSleep });
    expect(await svc.generate('x')).toBe('data:image/png;base64,QUJD');
    expect(calls).toBe(3);
  });

  it('falls back to the placeholder image when every attempt throws', async () => {
    const client: GenAiImageClient = {
      models: { generateContent: vi.fn(async () => { throw new Error('boom'); }) },
    };
    const svc = new GeminiImageService(client, { maxRetries: 2, sleep: noSleep });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_IMAGE);
    expect(client.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it('falls back to the placeholder when the response has no image part', async () => {
    const client = clientReturning(undefined);
    const svc = new GeminiImageService(client, { maxRetries: 1, sleep: noSleep });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_IMAGE);
    // No-image is treated as transient: maxRetries: 1 => initial attempt + 1 retry = 2 calls.
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('exposes a placeholder that is itself a parseable data URL', () => {
    expect(() => parseDataUrl(PLACEHOLDER_IMAGE)).not.toThrow();
  });
});
