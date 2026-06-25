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

  it('falls back to the placeholder URL when the inner service throws', async () => {
    const inner: ImageService = { generate: vi.fn(async () => { throw new Error('image gen down'); }) };
    const uploader: ImageUploader = { upload: vi.fn() };
    const svc = new StorageImageService(inner, uploader, { placeholderUrl: PLACEHOLDER_URL });
    expect(await svc.generate('x')).toBe(PLACEHOLDER_URL);
    expect(uploader.upload).not.toHaveBeenCalled();
  });
});
