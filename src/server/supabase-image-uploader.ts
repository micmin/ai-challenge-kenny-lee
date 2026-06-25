import type { ImageUploader } from './storage-image-service';

// Minimal shape of the Supabase Storage client this uploader uses.
export interface StorageBucketClient {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options: { contentType: string; upsert?: boolean },
    ): Promise<{ error: unknown }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
}

export class SupabaseImageUploader implements ImageUploader {
  constructor(private readonly client: StorageBucketClient, private readonly bucket: string) {}

  async upload(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const { error } = await this.client.from(this.bucket).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`upload failed: ${String(error)}`);
    return this.client.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }
}
