import { describe, it, expect } from 'vitest';
import { GameEngine, GameStore, MockAI } from './index';

describe('engine public API', () => {
  it('re-exports the engine building blocks', () => {
    const engine = new GameEngine(new GameStore(), new MockAI());
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    expect(engine.getGame(gameId).status).toBe('lobby');
  });
});
