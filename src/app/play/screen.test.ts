import { describe, it, expect } from 'vitest';
import { deriveScreen, imageForTask, roundOf } from './screen';
import type { Game, Step } from '../../engine/index';

function caption(chainId: string, position: number): Step {
  return { id: `s${position}`, chainId, position, type: 'caption', authorPlayerId: 'p1', content: '', isAutoFilled: false, status: 'pending', deadline: null };
}

describe('deriveScreen', () => {
  it('maps status to a screen', () => {
    expect(deriveScreen({ status: 'active' } as Game)).toBe('yourTurn');
    expect(deriveScreen({ status: 'reveal' } as Game)).toBe('reveal');
    expect(deriveScreen({ status: 'done' } as Game)).toBe('done');
  });
});

describe('imageForTask', () => {
  it('returns the image one position before the caption task', () => {
    const game = {
      chains: [{ id: 'c1', gameId: 'g1', seedPlayerId: 'p1', steps: [
        { id: 's0', chainId: 'c1', position: 0, type: 'caption', authorPlayerId: 'p2', content: 'seed', isAutoFilled: true, status: 'filled', deadline: null },
        { id: 's1', chainId: 'c1', position: 1, type: 'image', authorPlayerId: null, content: 'img://x', isAutoFilled: false, status: 'filled', deadline: null },
      ] }],
    } as unknown as Game;
    expect(imageForTask(game, caption('c1', 2))).toBe('img://x');
  });
  it('returns null for a seed task (position 0)', () => {
    const game = { chains: [{ id: 'c1', steps: [] }] } as unknown as Game;
    expect(imageForTask(game, caption('c1', 0))).toBeNull();
  });
});

describe('roundOf', () => {
  it('is 1-based on caption position', () => {
    expect(roundOf(caption('c1', 0))).toBe(1);
    expect(roundOf(caption('c1', 2))).toBe(2);
  });
});
