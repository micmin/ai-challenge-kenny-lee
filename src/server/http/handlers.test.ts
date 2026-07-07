import { describe, it, expect, vi } from 'vitest';
import {
  createGameHandler,
  joinGameHandler,
  startGameHandler,
  getStateHandler,
  submitCaptionHandler,
} from './handlers';
import type { GameServicePort } from '../game-service';

function fakeService(overrides: Partial<GameServicePort> = {}): GameServicePort {
  return {
    createGame: vi.fn(async () => ({ gameId: 'g1', hostId: 'p1' })),
    joinGame: vi.fn(async () => ({ playerId: 'p2', view: { game: { id: 'g1' } as any, pendingTasks: [] } })),
    startGame: vi.fn(async () => ({ id: 'g1', status: 'active' } as any)),
    submitCaption: vi.fn(async () => ({ game: { id: 'g1' } as any, pendingTasks: [] })),
    getState: vi.fn(async () => ({ game: { id: 'g1' } as any, pendingTasks: [] })),
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request('http://test', { method: 'POST', body: JSON.stringify(body) });
}

function postRaw(raw: string): Request {
  return new Request('http://test', { method: 'POST', body: raw });
}

describe('createGameHandler', () => {
  it('creates a game from a valid body', async () => {
    const svc = fakeService();
    const res = await createGameHandler(svc, post({ hostName: 'Ada', turnDeadlineMs: 60000 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ gameId: 'g1', hostId: 'p1' });
    expect(svc.createGame).toHaveBeenCalledWith('Ada', 60000);
  });

  it('rejects a blank hostName with 400', async () => {
    const res = await createGameHandler(fakeService(), post({ hostName: '  ', turnDeadlineMs: 60000 }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive turnDeadlineMs with 400', async () => {
    const res = await createGameHandler(fakeService(), post({ hostName: 'Ada', turnDeadlineMs: 0 }));
    expect(res.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await createGameHandler(fakeService(), postRaw('not json'));
    expect(res.status).toBe(400);
  });

  it('rejects a non-object JSON body with 400', async () => {
    const res = await createGameHandler(fakeService(), postRaw('[]'));
    expect(res.status).toBe(400);
  });
});

describe('joinGameHandler', () => {
  it('joins with a valid name', async () => {
    const svc = fakeService();
    const res = await joinGameHandler(svc, 'g1', post({ name: 'Bea' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ playerId: 'p2', view: { game: { id: 'g1' }, pendingTasks: [] } });
    expect(svc.joinGame).toHaveBeenCalledWith('g1', 'Bea');
  });

  it('rejects a blank name with 400', async () => {
    const res = await joinGameHandler(fakeService(), 'g1', post({ name: '' }));
    expect(res.status).toBe(400);
  });

  it('maps a not-found game to 404', async () => {
    const svc = fakeService({ joinGame: vi.fn(async () => { throw new Error('Game not found: g1'); }) });
    const res = await joinGameHandler(svc, 'g1', post({ name: 'Bea' }));
    expect(res.status).toBe(404);
  });
});

describe('startGameHandler', () => {
  it('starts the game and returns it', async () => {
    const svc = fakeService();
    const res = await startGameHandler(svc, 'g1', post({}));
    expect(res.status).toBe(200);
    expect(svc.startGame).toHaveBeenCalledWith('g1');
  });

  it('maps "need at least 2 players" to 409', async () => {
    const svc = fakeService({ startGame: vi.fn(async () => { throw new Error('need at least 2 players'); }) });
    expect((await startGameHandler(svc, 'g1', post({}))).status).toBe(409);
  });
});

describe('getStateHandler', () => {
  it('returns the player-scoped view from the playerId query param', async () => {
    const svc = fakeService();
    const req = new Request('http://test/api/games/g1?playerId=p2');
    const res = await getStateHandler(svc, 'g1', req);
    expect(res.status).toBe(200);
    expect(svc.getState).toHaveBeenCalledWith('g1', 'p2');
  });

  it('rejects a missing playerId with 400', async () => {
    const res = await getStateHandler(fakeService(), 'g1', new Request('http://test/api/games/g1'));
    expect(res.status).toBe(400);
  });
});

describe('submitCaptionHandler', () => {
  it('submits a caption from a valid body', async () => {
    const svc = fakeService();
    const res = await submitCaptionHandler(svc, 'g1', post({ playerId: 'p2', stepId: 's5', text: 'a cat' }));
    expect(res.status).toBe(200);
    expect(svc.submitCaption).toHaveBeenCalledWith('g1', 'p2', 's5', 'a cat');
  });

  it('rejects missing fields with 400', async () => {
    const res = await submitCaptionHandler(fakeService(), 'g1', post({ playerId: 'p2', text: 'a cat' }));
    expect(res.status).toBe(400);
  });

  it('maps "not your turn" to 409', async () => {
    const svc = fakeService({ submitCaption: vi.fn(async () => { throw new Error('not your turn'); }) });
    const res = await submitCaptionHandler(svc, 'g1', post({ playerId: 'p2', stepId: 's5', text: 'x' }));
    expect(res.status).toBe(409);
  });

  it('maps "step not found" to 404', async () => {
    const svc = fakeService({ submitCaption: vi.fn(async () => { throw new Error('step not found: s99'); }) });
    const res = await submitCaptionHandler(svc, 'g1', post({ playerId: 'p2', stepId: 's99', text: 'x' }));
    expect(res.status).toBe(404);
  });
});
