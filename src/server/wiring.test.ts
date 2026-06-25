import { describe, it, expect } from 'vitest';
import { createGameService } from './wiring';

const full = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
  ANTHROPIC_API_KEY: 'a',
  GEMINI_API_KEY: 'g',
};

describe('createGameService', () => {
  it('throws when SUPABASE_URL is missing', () => {
    const { SUPABASE_URL, ...rest } = full;
    expect(() => createGameService(rest as any)).toThrow('SUPABASE_URL');
  });

  it('throws when SUPABASE_SERVICE_KEY is missing', () => {
    const { SUPABASE_SERVICE_KEY, ...rest } = full;
    expect(() => createGameService(rest as any)).toThrow('SUPABASE_SERVICE_KEY');
  });

  it('throws when an AI key is missing (delegated to createRealAIServices)', () => {
    const { ANTHROPIC_API_KEY, ...rest } = full;
    expect(() => createGameService(rest as any)).toThrow('ANTHROPIC_API_KEY');
  });

  it('builds a GameService when all env is present', () => {
    const svc = createGameService(full);
    expect(typeof svc.createGame).toBe('function');
    expect(typeof svc.submitCaption).toBe('function');
  });
});
