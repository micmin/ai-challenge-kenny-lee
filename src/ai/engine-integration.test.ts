import { describe, it, expect, vi } from 'vitest';
import { GameEngine, GameStore, type AIServices } from '../engine/index';
import { GeminiImageService, type GenAiImageClient } from './gemini-image-service';
import { ClaudeCaptionService, type ClaudeMessagesClient } from './claude-caption-service';
import { toDataUrl } from './data-url';

function fakeAI(): AIServices {
  const genai: GenAiImageClient = {
    models: {
      generateContent: vi.fn(async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: 'QUJD', mimeType: 'image/png' } }] } }],
      })),
    },
  };
  const claude: ClaudeMessagesClient = {
    messages: {
      create: vi.fn(async () => ({ content: [{ type: 'text', text: 'a drawing of something' }] })),
    },
  };
  return {
    image: new GeminiImageService(genai, { sleep: async () => {} }),
    caption: new ClaudeCaptionService(claude, {}),
  };
}

describe('real wrappers satisfy the engine contract', () => {
  it('plays a full 3-player game to reveal using the real wrapper classes', async () => {
    const engine = new GameEngine(new GameStore(), fakeAI());
    const { gameId } = engine.createGame('Ada', 60_000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.joinGame(gameId, 'Cy');
    engine.startGame(gameId, 0);

    const playerIds = engine.getGame(gameId).players.map((p) => p.id);
    let guard = 0;
    while (!engine.isComplete(gameId) && guard++ < 200) {
      for (const pid of playerIds) {
        for (const task of engine.getPendingTasks(gameId, pid)) {
          await engine.submitCaption(gameId, pid, task.id, `${pid}-says`, 0);
        }
      }
    }

    const game = engine.getGame(gameId);
    expect(engine.isComplete(gameId)).toBe(true);
    expect(game.status).toBe('reveal');
    // image steps now hold real data URLs produced by GeminiImageService
    const imageStep = game.chains[0].steps.find((s) => s.type === 'image')!;
    expect(imageStep.content).toBe(toDataUrl('image/png', 'QUJD'));
  });

  it('auto-fills a missed caption from the preceding image via ClaudeCaptionService', async () => {
    const engine = new GameEngine(new GameStore(), fakeAI());
    const { gameId, hostId } = engine.createGame('Ada', 1000, 0);
    engine.joinGame(gameId, 'Bea');
    engine.startGame(gameId, 0);

    const seed = engine.getPendingTasks(gameId, hostId)[0];
    await engine.submitCaption(gameId, hostId, seed.id, 'a cat doing taxes', 0);
    await engine.processDeadlines(gameId, 5000); // Bea misses her turn

    const chain = engine.getGame(gameId).chains.find((c) => c.seedPlayerId === hostId)!;
    const beaCaption = chain.steps[2];
    expect(beaCaption).toMatchObject({ type: 'caption', status: 'filled', isAutoFilled: true });
    expect(beaCaption.content).toBe('a drawing of something');
  });
});
