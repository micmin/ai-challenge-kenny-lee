import { describe, it, expect } from 'vitest';
import type { Game, Player, Chain, Step } from './types';

describe('domain types', () => {
  // This test's real value is compilation: if the interfaces change shape,
  // `npm run typecheck` (tsc) fails on the annotated literals below. The
  // runtime assertion is minimal — it just keeps the test runner happy.
  it('constructs a fully-formed game object without type errors', () => {
    const player: Player = { id: 'p1', name: 'Ada', joinOrder: 0 };
    const step: Step = {
      id: 's1',
      chainId: 'c1',
      position: 0,
      type: 'caption',
      authorPlayerId: 'p1',
      content: 'a cat doing taxes',
      isAutoFilled: false,
      status: 'pending',
      deadline: 1000,
    };
    const chain: Chain = { id: 'c1', gameId: 'g1', seedPlayerId: 'p1', steps: [step] };
    const game: Game = {
      id: 'g1',
      hostId: 'p1',
      status: 'active',
      turnDeadlineMs: 60_000,
      players: [player],
      chains: [chain],
      createdAt: 0,
    };
    expect(game.chains[0].steps[0].type).toBe('caption');
  });
});
