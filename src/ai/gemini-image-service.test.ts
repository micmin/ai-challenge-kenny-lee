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
    const client = clientReturning(undefined);
    const svc = new GeminiImageService(client, { maxRetries: 1, sleep: noSleep });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_IMAGE);
    // Empty-bytes is treated as transient: maxRetries: 1 => initial attempt + 1 retry = 2 calls.
    expect(client.models.generateImages).toHaveBeenCalledTimes(2);
  });
});
