import { createClient } from '@supabase/supabase-js';
import { createRealAIServices, StorageImageService } from './ai-reexports';
import type { AIServices } from '../engine/index';
import { GameService } from './game-service';
import { SupabaseGameRepository, type GamesTableClient } from './supabase-game-repository';
import { SupabaseImageUploader, type StorageBucketClient } from './supabase-image-uploader';
import { uuidIdGenerator } from './id-generator';

export interface ServerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  IMAGE_BUCKET?: string;
  PLACEHOLDER_IMAGE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CAPTION_MODEL?: string;
  IMAGE_MODEL?: string;
}

export function createGameService(
  env: ServerEnv = process.env as Record<string, string | undefined>,
): GameService {
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL is required');
  if (!env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY is required');

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const bucket = env.IMAGE_BUCKET ?? 'images';
  const placeholderUrl =
    env.PLACEHOLDER_IMAGE_URL ??
    `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/placeholder.png`;

  // Reuse Plan 2's AI services (validates ANTHROPIC/GEMINI keys); wrap only the image service.
  const base = createRealAIServices(env);
  const uploader = new SupabaseImageUploader(supabase as unknown as StorageBucketClient, bucket);
  const ai: AIServices = {
    image: new StorageImageService(base.image, uploader, { placeholderUrl }),
    caption: base.caption,
  };

  const repository = new SupabaseGameRepository(supabase as unknown as GamesTableClient);
  return new GameService({ repository, ai, idGenerator: uuidIdGenerator });
}
