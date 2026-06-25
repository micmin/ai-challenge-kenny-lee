import { describe, it, expect } from 'vitest';
import { GameService, ConcurrencyError } from './game-service';
import { InMemoryGameRepository, type GameRepository, type LoadedGame } from './game-repository';
import { MockAI } from '../engine/index';
import { uuidIdGenerator } from './id-generator';
import type { Game } from '../engine/index';

function newService(repo: GameRepository = new InMemoryGameRepository(), now = () => 0) {
  return new GameService({ repository: repo, ai: new MockAI(), idGenerator: uuidIdGenerator, now });
}

describe('GameService lifecycle', () => {
  it('creates and persists a game', async () => {
    const repo = new InMemoryGameRepository();
    const svc = newService(repo);
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    const loaded = await repo.load(gameId);
    expect(loaded).not.toBeNull();
    expect(loaded!.state.hostId).toBe(hostId);
    expect(loaded!.state.status).toBe('lobby');
  });

  it('joins, starts, and returns the joiner a player-scoped view', async () => {
    const svc = newService();
    const { gameId } = await svc.createGame('Ada', 60_000);
    const { playerId, view } = await svc.joinGame(gameId, 'Bea');
    expect(view.game.players.map((p) => p.name)).toEqual(['Ada', 'Bea']);
    await svc.startGame(gameId);
    const bea = await svc.getState(gameId, playerId);
    expect(bea.pendingTasks).toHaveLength(1); // Bea's seed caption
  });

  it('plays a full 2-player game to reveal through the service', async () => {
    const svc = newService();
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    const { playerId: beaId } = await svc.joinGame(gameId, 'Bea');
    await svc.startGame(gameId);

    let guard = 0;
    let view = await svc.getState(gameId, hostId);
    while (view.game.status !== 'reveal' && guard++ < 50) {
      for (const pid of [hostId, beaId]) {
        const s = await svc.getState(gameId, pid);
        for (const task of s.pendingTasks) {
          view = await svc.submitCaption(gameId, pid, task.id, `${pid}-text`);
        }
      }
      view = await svc.getState(gameId, hostId);
    }
    expect(view.game.status).toBe('reveal');
  });

  it('propagates engine guard errors (not your turn)', async () => {
    const svc = newService();
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    const { playerId: beaId } = await svc.joinGame(gameId, 'Bea');
    await svc.startGame(gameId);
    const adaSeed = (await svc.getState(gameId, hostId)).pendingTasks[0];
    await expect(svc.submitCaption(gameId, beaId, adaSeed.id, 'x')).rejects.toThrow('not your turn');
  });

  it('retries on a version conflict and eventually succeeds', async () => {
    const inner = new InMemoryGameRepository();
    let failNextSave = true;
    const flaky: GameRepository = {
      load: (id) => inner.load(id),
      insert: (g) => inner.insert(g),
      save: async (id, state, version) => {
        if (failNextSave) { failNextSave = false; return false; } // simulate a lost race once
        return inner.save(id, state, version);
      },
    };
    const svc = newService(flaky);
    const { gameId } = await svc.createGame('Ada', 60_000);
    const { view } = await svc.joinGame(gameId, 'Bea'); // first save fails → retry → succeeds
    expect(view.game.players).toHaveLength(2);
  });

  it('throws ConcurrencyError when conflicts never clear', async () => {
    const inner = new InMemoryGameRepository();
    const alwaysConflict: GameRepository = {
      load: (id) => inner.load(id),
      insert: (g) => inner.insert(g),
      save: async () => false,
    };
    const svc = new GameService({
      repository: alwaysConflict, ai: new MockAI(), idGenerator: uuidIdGenerator, now: () => 0, maxRetries: 3,
    });
    const { gameId } = await svc.createGame('Ada', 60_000);
    await expect(svc.joinGame(gameId, 'Bea')).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('skips the save when a read changes nothing (no version churn)', async () => {
    const inner = new InMemoryGameRepository();
    let saves = 0;
    const counting: GameRepository = {
      load: (id) => inner.load(id),
      insert: (g) => inner.insert(g),
      save: (id, state, version) => { saves += 1; return inner.save(id, state, version); },
    };
    const svc = newService(counting);
    const { gameId, hostId } = await svc.createGame('Ada', 60_000);
    await svc.joinGame(gameId, 'Bea');
    await svc.startGame(gameId);
    const savesBefore = saves;
    await svc.getState(gameId, hostId); // no overdue deadlines → no state change → no save
    expect(saves).toBe(savesBefore);
  });
});
