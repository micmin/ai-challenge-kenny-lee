import type { AIServices } from './ai';
import type { GameStore } from './store';
import type { Chain, Game, Player, Step } from './types';

export type IdGenerator = (prefix: string) => string;

function createCounterIdGenerator(): IdGenerator {
  const counters: Record<string, number> = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${counters[prefix]}`;
  };
}

export class GameEngine {
  private readonly idgen: IdGenerator;

  constructor(
    private store: GameStore,
    private ai: AIServices,
    idGenerator: IdGenerator = createCounterIdGenerator(),
  ) {
    this.idgen = idGenerator;
  }

  private id(prefix: string): string {
    return this.idgen(prefix);
  }

  getGame(gameId: string): Game {
    return this.store.get(gameId);
  }

  createGame(hostName: string, turnDeadlineMs: number, now: number): { gameId: string; hostId: string } {
    const hostId = this.id('p');
    const host: Player = { id: hostId, name: hostName, joinOrder: 0 };
    const game: Game = {
      id: this.id('g'),
      hostId,
      status: 'lobby',
      turnDeadlineMs,
      players: [host],
      chains: [],
      createdAt: now,
    };
    this.store.save(game);
    return { gameId: game.id, hostId };
  }

  joinGame(gameId: string, name: string): { playerId: string } {
    const game = this.store.get(gameId);
    if (game.status !== 'lobby') throw new Error('game already started');
    const playerId = this.id('p');
    game.players.push({ id: playerId, name, joinOrder: game.players.length });
    this.store.save(game);
    return { playerId };
  }

  startGame(gameId: string, now: number): void {
    const game = this.store.get(gameId);
    if (game.status !== 'lobby') throw new Error('game already started');
    if (game.players.length < 2) throw new Error('need at least 2 players');

    game.chains = game.players.map((seedPlayer) => {
      const chain: Chain = {
        id: this.id('c'),
        gameId: game.id,
        seedPlayerId: seedPlayer.id,
        steps: [],
      };
      const seedStep: Step = {
        id: this.id('s'),
        chainId: chain.id,
        position: 0,
        type: 'caption',
        authorPlayerId: seedPlayer.id,
        content: '',
        isAutoFilled: false,
        status: 'pending',
        deadline: now + game.turnDeadlineMs,
      };
      chain.steps.push(seedStep);
      return chain;
    });

    game.status = 'active';
    this.store.save(game);
  }

  getPendingTasks(gameId: string, playerId: string): Step[] {
    const game = this.store.get(gameId);
    const tasks: Step[] = [];
    for (const chain of game.chains) {
      for (const step of chain.steps) {
        if (step.type === 'caption' && step.status === 'pending' && step.authorPlayerId === playerId) {
          tasks.push(step);
        }
      }
    }
    return tasks;
  }

  async submitCaption(gameId: string, playerId: string, stepId: string, text: string, now: number): Promise<void> {
    const game = this.store.get(gameId);
    if (game.status !== 'active') throw new Error('game is not active');
    const located = this.locateStep(game, stepId);
    if (!located) throw new Error(`step not found: ${stepId}`);
    const { chain, step } = located;
    if (step.type !== 'caption' || step.status !== 'pending') {
      throw new Error('step is not an open caption');
    }
    if (step.authorPlayerId !== playerId) throw new Error('not your turn');

    step.content = text;
    step.status = 'filled';
    step.isAutoFilled = false;
    step.deadline = null;

    await this.advanceChain(game, chain, step, now);
    this.refreshStatus(game);
    this.store.save(game);
  }

  // Fill a pending caption via AI (seed prompt at position 0, else caption-for-image),
  // mark it auto-filled, and advance the chain. Shared by processDeadlines and fillNextAiCaption.
  private async fillCaption(game: Game, chain: Chain, step: Step, now: number): Promise<void> {
    if (step.position === 0) {
      step.content = await this.ai.caption.seedCaption();
    } else {
      const prevImage = chain.steps.find((s) => s.position === step.position - 1);
      if (!prevImage) throw new Error('missing preceding image step');
      step.content = await this.ai.caption.captionForImage(prevImage.content);
    }
    step.status = 'filled';
    step.isAutoFilled = true;
    step.deadline = null;
    await this.advanceChain(game, chain, step, now);
  }

  async processDeadlines(gameId: string, now: number): Promise<void> {
    const game = this.store.get(gameId);
    if (game.status !== 'active') return;
    for (const chain of game.chains) {
      // Snapshot pending overdue captions; advanceChain mutates chain.steps as we go.
      const overdue = chain.steps.filter(
        (s) => s.type === 'caption' && s.status === 'pending' && s.deadline !== null && s.deadline <= now,
      );
      for (const step of overdue) {
        await this.fillCaption(game, chain, step, now);
      }
    }
    this.refreshStatus(game);
    this.store.save(game);
  }

  // Fill the next pending caption owned by a non-human (AI) seat, one per call.
  async fillNextAiCaption(
    gameId: string,
    humanPlayerId: string,
    now: number,
  ): Promise<{ filled: boolean; authorName: string | null }> {
    const game = this.store.get(gameId);
    if (game.status !== 'active') return { filled: false, authorName: null };

    // Find the pending AI caption with the smallest position (prioritizes seeds at position 0).
    let target: { chain: Chain; step: Step } | null = null;
    for (const chain of game.chains) {
      for (const step of chain.steps) {
        if (step.type === 'caption' && step.status === 'pending' && step.authorPlayerId !== humanPlayerId) {
          if (!target || step.position < target.step.position) {
            target = { chain, step };
          }
        }
      }
    }

    if (target) {
      const author = game.players.find((p) => p.id === target.step.authorPlayerId) ?? null;
      await this.fillCaption(game, target.chain, target.step, now);
      this.refreshStatus(game);
      this.store.save(game);
      return { filled: true, authorName: author ? author.name : null };
    }
    return { filled: false, authorName: null };
  }

  private locateStep(game: Game, stepId: string): { chain: Chain; step: Step } | null {
    for (const chain of game.chains) {
      const step = chain.steps.find((s) => s.id === stepId);
      if (step) return { chain, step };
    }
    return null;
  }

  private seedIndexOf(game: Game, chain: Chain): number {
    const index = game.players.findIndex((p) => p.id === chain.seedPlayerId);
    if (index === -1) throw new Error('seed player not in game');
    return index;
  }

  // Called after a caption step is filled: render its image, then open the next caption if any remain.
  private async advanceChain(game: Game, chain: Chain, captionStep: Step, now: number): Promise<void> {
    const n = game.players.length;
    const captionIndex = captionStep.position / 2;

    const imageContent = await this.ai.image.generate(captionStep.content);
    const imageStep: Step = {
      id: this.id('s'),
      chainId: chain.id,
      position: captionStep.position + 1,
      type: 'image',
      authorPlayerId: null,
      content: imageContent,
      isAutoFilled: false,
      status: 'filled',
      deadline: null,
    };
    chain.steps.push(imageStep);

    const nextIndex = captionIndex + 1;
    if (nextIndex < n) {
      const seedIndex = this.seedIndexOf(game, chain);
      const author = game.players[(seedIndex + nextIndex) % n];
      chain.steps.push({
        id: this.id('s'),
        chainId: chain.id,
        position: imageStep.position + 1,
        type: 'caption',
        authorPlayerId: author.id,
        content: '',
        isAutoFilled: false,
        status: 'pending',
        deadline: now + game.turnDeadlineMs,
      });
    }
  }

  private chainIsComplete(game: Game, chain: Chain): boolean {
    const expected = 2 * game.players.length;
    return chain.steps.length === expected && chain.steps.every((s) => s.status === 'filled');
  }

  private refreshStatus(game: Game): void {
    if (game.status === 'active' && game.chains.every((c) => this.chainIsComplete(game, c))) {
      game.status = 'reveal';
    }
  }

  isComplete(gameId: string): boolean {
    const game = this.store.get(gameId);
    return game.chains.length > 0 && game.chains.every((c) => this.chainIsComplete(game, c));
  }
}
