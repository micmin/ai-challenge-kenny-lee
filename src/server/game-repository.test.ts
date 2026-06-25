import { describe, it, expect } from 'vitest';
import { InMemoryGameRepository } from './game-repository';
import type { Game } from '../engine/index';

function game(id: string, status: Game['status'] = 'lobby'): Game {
  return { id, hostId: 'p1', status, turnDeadlineMs: 60_000, players: [], chains: [], createdAt: 0 };
}

describe('InMemoryGameRepository', () => {
  it('returns null for an unknown game', async () => {
    expect(await new InMemoryGameRepository().load('nope')).toBeNull();
  });

  it('inserts at version 0 and loads it back', async () => {
    const repo = new InMemoryGameRepository();
    await repo.insert(game('g1'));
    expect(await repo.load('g1')).toEqual({ state: game('g1'), version: 0 });
  });

  it('saves with a matching version and bumps it', async () => {
    const repo = new InMemoryGameRepository();
    await repo.insert(game('g1'));
    const ok = await repo.save('g1', game('g1', 'active'), 0);
    expect(ok).toBe(true);
    expect(await repo.load('g1')).toEqual({ state: game('g1', 'active'), version: 1 });
  });

  it('rejects a save with a stale version', async () => {
    const repo = new InMemoryGameRepository();
    await repo.insert(game('g1'));
    expect(await repo.save('g1', game('g1', 'active'), 5)).toBe(false);
  });

  it('isolates stored state from later caller mutation', async () => {
    const repo = new InMemoryGameRepository();
    const g = game('g1');
    await repo.insert(g);
    g.status = 'done';
    expect((await repo.load('g1'))!.state.status).toBe('lobby');
  });
});
