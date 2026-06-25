import { describe, it, expect } from 'vitest';
import { MockAI } from './ai';

describe('MockAI image service', () => {
  it('renders a caption into a deterministic image reference', async () => {
    const ai = new MockAI();
    const img = await ai.image.generate('a cat doing taxes');
    expect(img).toBe('mock-image://a%20cat%20doing%20taxes');
  });
});

describe('MockAI caption service', () => {
  it('captions an image by referencing its content (visible drift)', async () => {
    const ai = new MockAI();
    const caption = await ai.caption.captionForImage('mock-image://a%20cat%20doing%20taxes');
    expect(caption).toBe('a drawing of a cat doing taxes');
  });

  it('produces deterministic, cycling seed captions', async () => {
    const ai = new MockAI();
    const first = await ai.caption.seedCaption();
    const second = await ai.caption.seedCaption();
    expect(first).toBe('a cat doing taxes');
    expect(second).toBe('a dog astronaut');
    expect(first).not.toBe(second);
  });

  it('advances the seed counter even when seedCaption is destructured', async () => {
    const ai = new MockAI();
    // Pulled off the object: the arrow fn must keep `this` bound to the instance
    // so the counter still advances (guards against a `this`-dependent regression).
    const { seedCaption } = ai.caption;
    expect(await seedCaption()).toBe('a cat doing taxes');
    expect(await seedCaption()).toBe('a dog astronaut');
  });
});
