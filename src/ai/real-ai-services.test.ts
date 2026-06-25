import { describe, it, expect } from 'vitest';
import { createRealAIServices } from './real-ai-services';

describe('createRealAIServices', () => {
  it('throws a clear error when ANTHROPIC_API_KEY is missing', () => {
    expect(() => createRealAIServices({ GEMINI_API_KEY: 'g' })).toThrow('ANTHROPIC_API_KEY');
  });

  it('throws a clear error when GEMINI_API_KEY is missing', () => {
    expect(() => createRealAIServices({ ANTHROPIC_API_KEY: 'a' })).toThrow('GEMINI_API_KEY');
  });

  it('builds an AIServices with image and caption when both keys are present', () => {
    const ai = createRealAIServices({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    expect(typeof ai.image.generate).toBe('function');
    expect(typeof ai.caption.captionForImage).toBe('function');
    expect(typeof ai.caption.seedCaption).toBe('function');
  });
});
