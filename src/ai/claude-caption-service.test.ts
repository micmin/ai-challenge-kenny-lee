import { describe, it, expect, vi } from 'vitest';
import {
  ClaudeCaptionService,
  FALLBACK_CAPTION,
  type ClaudeMessagesClient,
} from './claude-caption-service';
import { toDataUrl } from './data-url';

function clientReplying(text: string | undefined): ClaudeMessagesClient {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: text === undefined ? [] : [{ type: 'text', text }],
      })),
    },
  };
}

describe('ClaudeCaptionService.captionForImage', () => {
  it('sends the image as a base64 block and returns the trimmed caption', async () => {
    const client = clientReplying('  a cat filing a 1040 form  ');
    const svc = new ClaudeCaptionService(client, { model: 'claude-haiku-4-5' });
    const url = toDataUrl('image/png', 'QUJD');

    const caption = await svc.captionForImage(url);

    expect(caption).toBe('a cat filing a 1040 form');
    const arg = (client.messages.create as any).mock.calls[0][0];
    expect(arg.model).toBe('claude-haiku-4-5');
    expect(arg.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
    });
    expect(arg.messages[0].content[1].type).toBe('text');
  });

  it('falls back to a safe caption when Claude returns no text', async () => {
    const svc = new ClaudeCaptionService(clientReplying(undefined), {});
    expect(await svc.captionForImage(toDataUrl('image/png', 'QUJD'))).toBe(FALLBACK_CAPTION);
  });

  it('falls back to a safe caption when the request throws', async () => {
    const client: ClaudeMessagesClient = {
      messages: { create: vi.fn(async () => { throw new Error('429'); }) },
    };
    const svc = new ClaudeCaptionService(client, {});
    expect(await svc.captionForImage(toDataUrl('image/png', 'QUJD'))).toBe(FALLBACK_CAPTION);
  });

  it('falls back to a safe caption when the stored content is not a data URL', async () => {
    const svc = new ClaudeCaptionService(clientReplying('ignored'), {});
    expect(await svc.captionForImage('mock-image://x')).toBe(FALLBACK_CAPTION);
  });
});

describe('ClaudeCaptionService.seedCaption', () => {
  it('returns Claude’s seed text when available', async () => {
    const svc = new ClaudeCaptionService(clientReplying('a penguin running a startup'), {});
    expect(await svc.seedCaption()).toBe('a penguin running a startup');
  });

  it('falls back to a non-empty seed when the request fails', async () => {
    const client: ClaudeMessagesClient = {
      messages: { create: vi.fn(async () => { throw new Error('boom'); }) },
    };
    const svc = new ClaudeCaptionService(client, {});
    const seed = await svc.seedCaption();
    expect(typeof seed).toBe('string');
    expect(seed.length).toBeGreaterThan(0);
  });
});
