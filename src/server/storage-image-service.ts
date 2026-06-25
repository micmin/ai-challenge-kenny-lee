import { randomUUID } from 'node:crypto';
import type { ImageService } from '../engine/index';
import { parseDataUrl, PLACEHOLDER_IMAGE } from '../ai/index';

export interface ImageUploader {
  /** Uploads bytes and returns the public URL. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

export interface StorageImageOptions {
  placeholderUrl: string;
  keyPrefix?: string;
  newKey?: () => string;
}

export class StorageImageService implements ImageService {
  private readonly placeholderUrl: string;
  private readonly keyPrefix: string;
  private readonly newKey: () => string;

  constructor(
    private readonly inner: ImageService,
    private readonly uploader: ImageUploader,
    opts: StorageImageOptions,
  ) {
    this.placeholderUrl = opts.placeholderUrl;
    this.keyPrefix = opts.keyPrefix ?? '';
    this.newKey = opts.newKey ?? (() => randomUUID());
  }

  async generate(caption: string): Promise<string> {
    const dataUrl = await this.inner.generate(caption);
    if (dataUrl === PLACEHOLDER_IMAGE) return this.placeholderUrl;
    try {
      const { mediaType, base64 } = parseDataUrl(dataUrl);
      const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
      const ext = mediaType.split('/')[1] ?? 'png';
      const path = `${this.keyPrefix}${this.newKey()}.${ext}`;
      return await this.uploader.upload(path, bytes, mediaType);
    } catch {
      return this.placeholderUrl;
    }
  }
}
