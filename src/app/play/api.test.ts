import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSolo, stepAi } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('client api', () => {
  it('createSolo posts seed + aiCount and returns the payload', async () => {
    const payload = { gameId: 'g1', hostId: 'p1', view: { game: { id: 'g1' }, pendingTasks: [] } };
    const fetchMock = vi.fn(async () => jsonResponse(payload, 201));
    vi.stubGlobal('fetch', fetchMock);

    const r = await createSolo('a cat', 3);

    expect(fetchMock).toHaveBeenCalledWith('/api/games/solo', expect.objectContaining({ method: 'POST' }));
    expect(r.gameId).toBe('g1');
  });

  it('stepAi throws the server error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 409)));
    await expect(stepAi('g1', 'p1')).rejects.toThrow('boom');
  });
});
