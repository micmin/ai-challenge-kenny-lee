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
