import { describe, it, expect, vi } from 'vitest';
import { SupabaseGameRepository, type GamesTableClient } from './supabase-game-repository';
import type { Game } from '../engine/index';

function game(id: string): Game {
  return { id, hostId: 'p1', status: 'lobby', turnDeadlineMs: 60_000, players: [], chains: [], createdAt: 0 };
}

// Builds a fake matching the exact chains the repository uses.
function fakeClient(opts: {
  loaded?: { id: string; state: Game; version: number } | null;
  updateRows?: Array<{ id: string }>;
}): { client: GamesTableClient; calls: any } {
  const calls: any = {};
  const client: GamesTableClient = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: opts.loaded ?? null, error: null }) }),
      }),
      insert: async (row) => { calls.inserted = row; return { error: null }; },
      update: (row) => {
        calls.updated = row;
        return { eq: () => ({ eq: () => ({ select: async () => ({ data: opts.updateRows ?? [], error: null }) }) }) };
      },
    }),
  };
  return { client, calls };
}

describe('SupabaseGameRepository', () => {
  it('loads a row into {state, version}', async () => {
    const { client } = fakeClient({ loaded: { id: 'g1', state: game('g1'), version: 3 } });
    const repo = new SupabaseGameRepository(client);
    expect(await repo.load('g1')).toEqual({ state: game('g1'), version: 3 });
  });

  it('returns null when the row is missing', async () => {
    const { client } = fakeClient({ loaded: null });
    expect(await new SupabaseGameRepository(client).load('g1')).toBeNull();
  });

  it('inserts at version 0', async () => {
    const { client, calls } = fakeClient({});
    await new SupabaseGameRepository(client).insert(game('g1'));
    expect(calls.inserted).toMatchObject({ id: 'g1', version: 0 });
  });

  it('save returns true when a row was updated', async () => {
    const { client } = fakeClient({ updateRows: [{ id: 'g1' }] });
    expect(await new SupabaseGameRepository(client).save('g1', game('g1'), 0)).toBe(true);
  });

  it('save returns false when no row matched the version (conflict)', async () => {
    const { client } = fakeClient({ updateRows: [] });
    expect(await new SupabaseGameRepository(client).save('g1', game('g1'), 0)).toBe(false);
  });
});
