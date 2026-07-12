import { describe, it, expect } from 'vitest';
import { GameEngine } from './engine';
import { GameStore } from './store';
import { MockAI } from './ai';

function newEngine() {
  return new GameEngine(new GameStore(), new MockAI());
}

describe('GameEngine lobby lifecycle', () => {
  it('creates a game with the host as the first player', () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const game = engine.getGame(gameId);
    expect(game.status).toBe('lobby');
    expect(game.hostId).toBe(hostId);
    expect(game.players).toHaveLength(1);
    expect(game.players[0]).toMatchObject({ id: hostId, name: 'Ada', joinOrder: 0 });
  });

  it('adds joining players in order', () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    const game = engine.getGame(gameId);
    expect(game.players.map((p) => p.name)).toEqual(['Ada', 'Bea', 'Cy']);
    expect(game.players.map((p) => p.joinOrder)).toEqual([0, 1, 2]);
  });

  it('refuses to start a game with fewer than 2 players', () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    expect(() => engine.startGame(gameId, 0)).toThrow('need at least 2 players');
  });

  it('seeds one chain per player on start, each with one pending seed caption', () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.startGame(gameId, 1000);

    const game = engine.getGame(gameId);
    expect(game.status).toBe('active');
    expect(game.chains).toHaveLength(3);

    game.chains.forEach((chain) => {
      expect(chain.steps).toHaveLength(1);
      const seed = chain.steps[0];
      expect(seed).toMatchObject({
        position: 0,
        type: 'caption',
        status: 'pending',
        authorPlayerId: chain.seedPlayerId, // seed player writes caption-index 0
        deadline: 1000 + 60_000,
      });
    });

    // each player seeds exactly one chain
    const seedPlayers = game.chains.map((c) => c.seedPlayerId).sort();
    expect(seedPlayers).toEqual(game.players.map((p) => p.id).sort());
  });
});

describe('GameEngine caption submission', () => {
  it('lists a player only the caption steps assigned to them', () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);
    const tasks = engine.getPendingTasks(gameId, hostId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].authorPlayerId).toBe(hostId);
  });

  it('fills the caption, generates an image, and opens the next caption', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const { playerId: beaId } = engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    const seedTask = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seedTask.id, 'a cat doing taxes', 5000);

    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    expect(chain.steps).toHaveLength(3);

    expect(chain.steps[0]).toMatchObject({ type: 'caption', status: 'filled', content: 'a cat doing taxes', isAutoFilled: false });
    expect(chain.steps[1]).toMatchObject({ type: 'image', status: 'filled', authorPlayerId: null, content: 'mock-image://a%20cat%20doing%20taxes' });
    // next caption assigned to the next player in rotation (Bea), with a fresh deadline
    expect(chain.steps[2]).toMatchObject({ type: 'caption', status: 'pending', authorPlayerId: beaId, deadline: 5000 + 60_000 });
  });

  it('does not open a new caption once every player has captioned the chain', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const { playerId: beaId } = engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    const chainId = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!.id;

    // caption-index 0 (Ada, seed)
    const t0 = engine.getPendingTasks(gameId, hostId).find((s) => s.chainId === chainId)!;
    await engine.submitCaption(gameId, hostId, t0.id, 'cat', 0);
    // caption-index 1 (Bea) — this is the last for a 2-player game
    const t1 = engine.getPendingTasks(gameId, beaId).find((s) => s.chainId === chainId)!;
    await engine.submitCaption(gameId, beaId, t1.id, 'dog', 0);

    const chain = engine.getGame(gameId).chains.find((c) => c.id === chainId)!;
    expect(chain.steps).toHaveLength(4); // 2 captions + 2 images, no further caption
    expect(chain.steps.filter((s) => s.status === 'pending')).toHaveLength(0);
  });

  it('rejects submitting a caption to a non-pending or non-caption step', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);
    const seedTask = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seedTask.id, 'cat', 0);
    await expect(engine.submitCaption(gameId, hostId, seedTask.id, 'again', 0)).rejects.toThrow('step is not an open caption');
  });

  it('rejects a caption submitted by a player who is not the assigned author', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const { playerId: beaId } = engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    // Bea attempts to submit the seed step assigned to Ada (the seed author).
    const seedTask = engine.getPendingTasks(gameId, hostId)[0];
    await expect(engine.submitCaption(gameId, beaId, seedTask.id, 'cat', 0)).rejects.toThrow('not your turn');

    // The step must remain pending and unfilled.
    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    expect(chain.steps[0]).toMatchObject({ status: 'pending', content: '' });
  });

  it('rejects a caption submission once the game is no longer active', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    const { playerId: beaId } = engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    // Play the 2-player game to completion so status becomes 'reveal'.
    let guard = 0;
    while (!engine.isComplete(gameId) && guard++ < 100) {
      for (const pid of [hostId, beaId]) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-says`, 0);
        }
      }
    }
    expect(engine.getGame(gameId).status).toBe('reveal');

    // Grab any existing (now-filled) step; the active guard runs first, so it
    // throws 'game is not active' rather than 'step is not an open caption'.
    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    const someStep = chain.steps[0];
    await expect(
      engine.submitCaption(gameId, someStep.authorPlayerId!, someStep.id, 'x', 0),
    ).rejects.toThrow('game is not active');
  });
});

describe('GameEngine rotation', () => {
  it('has each chain captioned by every player exactly once, seed first', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.startGame(gameId, 0);

    const playerIds = engine.getGame(gameId).players.map((p) => p.id);

    // Play every pending caption until none remain.
    let guard = 0;
    while (guard++ < 100) {
      let acted = false;
      for (const pid of playerIds) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-says`, 0);
          acted = true;
        }
      }
      if (!acted) break;
    }

    for (const chain of engine.getGame(gameId).chains) {
      const captionAuthors = chain.steps
        .filter((s) => s.type === 'caption')
        .map((s) => s.authorPlayerId);
      // the chain played to completion: one caption per player (3 for this game)
      expect(captionAuthors).toHaveLength(playerIds.length);
      // seed player captions first
      expect(captionAuthors[0]).toBe(chain.seedPlayerId);
      // every player captions the chain exactly once
      expect([...captionAuthors].sort()).toEqual([...playerIds].sort());
    }
  });
});

describe('GameEngine deadline auto-fill', () => {
  it('does not auto-fill before the deadline', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0); // deadlines at 1000
    await engine.processDeadlines(gameId, 999);
    for (const chain of engine.getGame(gameId).chains) {
      expect(chain.steps[0].status).toBe('pending');
    }
  });

  it('auto-fills an overdue seed caption with an AI seed and advances', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0); // deadlines at 1000

    await engine.processDeadlines(gameId, 2000);

    const chain = engine.getGame(gameId).chains[0];
    expect(chain.steps[0]).toMatchObject({ status: 'filled', isAutoFilled: true });
    expect(chain.steps[0].content.length).toBeGreaterThan(0);
    // chain advanced: image rendered, next caption opened (2-player game => one more)
    expect(chain.steps[1].type).toBe('image');
    expect(chain.steps[2]).toMatchObject({ type: 'caption', status: 'pending' });
  });

  it('auto-fills an overdue non-seed caption from the preceding image', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    // Ada submits her seed on time, opening Bea's caption with deadline 0 + 1000.
    const seed = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seed.id, 'a cat doing taxes', 0);

    // Bea misses the deadline; auto-fill should caption the preceding image.
    await engine.processDeadlines(gameId, 5000);

    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    const beaCaption = chain.steps[2];
    expect(beaCaption).toMatchObject({ type: 'caption', status: 'filled', isAutoFilled: true });
    expect(beaCaption.content).toBe('a drawing of a cat doing taxes');
  });

  it('does nothing when the game is not active', async () => {
    const engine = newEngine();
    const { gameId, hostId } = engine.createGame('Ada', 1000, 0);
    const { playerId: beaId } = engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    // Play the 2-player game to completion so status becomes 'reveal'.
    let guard = 0;
    while (!engine.isComplete(gameId) && guard++ < 100) {
      for (const pid of [hostId, beaId]) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-says`, 0);
        }
      }
    }
    expect(engine.getGame(gameId).status).toBe('reveal');

    const totalSteps = () =>
      engine.getGame(gameId).chains.reduce((sum, c) => sum + c.steps.length, 0);
    const before = totalSteps();

    await engine.processDeadlines(gameId, 10_000_000);

    expect(totalSteps()).toBe(before);
    expect(engine.getGame(gameId).status).toBe('reveal');
  });
});

describe('fillNextAiCaption', () => {
  it('fills the next non-human pending caption and renders its image', async () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId, hostId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);
    const humanSeed = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, humanSeed.id, 'a cat doing taxes', 0);

    const r = await engine.fillNextAiCaption(gameId, hostId, 0);

    expect(r.filled).toBe(true);
    expect(r.authorName).toBe('AI 1');
    const aiChain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId !== hostId)!;
    expect(aiChain.steps.some((s) => s.type === 'image')).toBe(true);
    expect(aiChain.steps[0].isAutoFilled).toBe(true);
  });

  it('returns filled=false when only human captions are pending', async () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId, hostId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);

    let guard = 0;
    let r = await engine.fillNextAiCaption(gameId, hostId, 0);
    while (r.filled && guard++ < 50) r = await engine.fillNextAiCaption(gameId, hostId, 0);

    expect(r.filled).toBe(false);
  });
});

describe('GameEngine completion', () => {
  it('flips to reveal and reports complete once all chains are full', async () => {
    const engine = newEngine();
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.joinGame(gameId, 'Dee');
    engine.startGame(gameId, 0);

    const n = engine.getGame(gameId).players.length;
    const playerIds = engine.getGame(gameId).players.map((p) => p.id);

    expect(engine.isComplete(gameId)).toBe(false);

    let guard = 0;
    while (!engine.isComplete(gameId) && guard++ < 200) {
      for (const pid of playerIds) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-${task.chainId}`, 0);
        }
      }
    }

    const game = engine.getGame(gameId);
    expect(engine.isComplete(gameId)).toBe(true);
    expect(game.status).toBe('reveal');
    // every chain: 2N steps, all filled, alternating caption/image
    for (const chain of game.chains) {
      expect(chain.steps).toHaveLength(2 * n);
      expect(chain.steps.every((s) => s.status === 'filled')).toBe(true);
      chain.steps.forEach((s, i) => expect(s.type).toBe(i % 2 === 0 ? 'caption' : 'image'));
    }
  });
});

describe('pickWinner', () => {
  it('records the winner and completes the game from reveal', async () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId, hostId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);

    let guard = 0;
    while (engine.getGame(gameId).status !== 'reveal' && guard++ < 100) {
      const tasks = engine.getPendingTasks(gameId, hostId);
      if (tasks.length) {
        await engine.submitCaption(gameId, hostId, tasks[0].id, 'human text', 0);
      } else if (!(await engine.fillNextAiCaption(gameId, hostId, 0)).filled) {
        break;
      }
    }
    expect(engine.getGame(gameId).status).toBe('reveal');

    const chainId = engine.getGame(gameId).chains[0].id;
    engine.pickWinner(gameId, chainId);

    expect(engine.getGame(gameId).status).toBe('done');
    expect(engine.getGame(gameId).winnerChainId).toBe(chainId);
  });

  it('rejects picking before reveal', () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);
    expect(() => engine.pickWinner(gameId, 'anything')).toThrow('game is not in reveal');
  });

  it('rejects an unknown chain once in reveal', async () => {
    const store = new GameStore();
    const engine = new GameEngine(store, new MockAI());
    const { gameId, hostId } = engine.createGame('You', 60_000, 0);
    engine.joinGame(gameId, 'AI 1');
    engine.startGame(gameId, 0);

    let guard = 0;
    while (engine.getGame(gameId).status !== 'reveal' && guard++ < 100) {
      const tasks = engine.getPendingTasks(gameId, hostId);
      if (tasks.length) {
        await engine.submitCaption(gameId, hostId, tasks[0].id, 'human text', 0);
      } else if (!(await engine.fillNextAiCaption(gameId, hostId, 0)).filled) {
        break;
      }
    }
    expect(engine.getGame(gameId).status).toBe('reveal');
    expect(() => engine.pickWinner(gameId, 'nonexistent-id')).toThrow('chain not found');
  });
});

describe('GameEngine injected id generator', () => {
  it('uses an injected id generator for new ids', () => {
    // Returns a deterministic id per prefix, so the assertion does not depend on
    // the engine's internal order of id() calls.
    const idgen = (prefix: string) => `${prefix}-X`;
    const engine = new GameEngine(new GameStore(), new MockAI(), idgen);
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    expect(gameId).toBe('g-X'); // game ids use the 'g' prefix
    expect(hostId).toBe('p-X'); // player ids use the 'p' prefix
  });

  it('defaults to the per-prefix counter generator when none is injected (back-compat)', () => {
    const engine = new GameEngine(new GameStore(), new MockAI());
    const { gameId, hostId } = engine.createGame('Ada', 60_000, 0);
    expect(gameId).toBe('g1');
    expect(hostId).toBe('p1');
  });
});
