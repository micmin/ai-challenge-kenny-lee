import { describe, it, expect } from 'vitest';
import { GameStore } from './store';
import type { Game } from './types';

function makeGame(id: string): Game {
  return {
    id,
    hostId: 'p1',
    status: 'lobby',
    turnDeadlineMs: 60_000,
    players: [],
    chains: [],
    createdAt: 0,
  };
}

describe('GameStore', () => {
  it('saves and retrieves a game by id', () => {
    const store = new GameStore();
    store.save(makeGame('g1'));
    expect(store.get('g1').id).toBe('g1');
  });

  it('reports whether a game exists', () => {
    const store = new GameStore();
    expect(store.has('g1')).toBe(false);
    store.save(makeGame('g1'));
    expect(store.has('g1')).toBe(true);
  });

  it('throws when getting a missing game', () => {
    const store = new GameStore();
    expect(() => store.get('nope')).toThrow('Game not found: nope');
  });

  it('overwrites a game when saving an existing id (get-mutate-save)', () => {
    const store = new GameStore();
    store.save(makeGame('g1'));
    const updated = { ...makeGame('g1'), status: 'active' as const };
    store.save(updated);
    expect(store.get('g1').status).toBe('active');
  });
});
