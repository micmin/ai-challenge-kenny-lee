import { GameEngine, GameStore } from '../engine/index';
import type { AIServices, Game, Step, IdGenerator } from '../engine/index';
import type { GameRepository } from './game-repository';

export class ConcurrencyError extends Error {}

export interface GameServiceDeps {
  repository: GameRepository;
  ai: AIServices;
  idGenerator: IdGenerator;
  now?: () => number;
  maxRetries?: number;
}

export interface GameView {
  game: Game;
  pendingTasks: Step[];
}

export class GameService {
  private readonly now: () => number;
  private readonly maxRetries: number;

  constructor(private readonly deps: GameServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.maxRetries = deps.maxRetries ?? 3;
  }

  private engineFor(state: Game | null): GameEngine {
    const store = new GameStore();
    if (state) store.save(state);
    return new GameEngine(store, this.deps.ai, this.deps.idGenerator);
  }

  async createGame(hostName: string, turnDeadlineMs: number): Promise<{ gameId: string; hostId: string }> {
    const engine = this.engineFor(null);
    const created = engine.createGame(hostName, turnDeadlineMs, this.now());
    await this.deps.repository.insert(engine.getGame(created.gameId));
    return created;
  }

  async joinGame(gameId: string, name: string): Promise<{ playerId: string; view: GameView }> {
    let playerId = '';
    // On a conflict retry, mutate() re-runs this callback with a fresh engine, so
    // playerId is reassigned to the id minted in the attempt that actually saved —
    // it always matches the returned game state.
    const game = await this.mutate(gameId, (engine) => {
      playerId = engine.joinGame(gameId, name).playerId;
    });
    return { playerId, view: this.viewFor(game, playerId) };
  }

  async startGame(gameId: string): Promise<Game> {
    return this.mutate(gameId, (engine) => {
      engine.startGame(gameId, this.now());
    });
  }

  async submitCaption(gameId: string, playerId: string, stepId: string, text: string): Promise<GameView> {
    const game = await this.mutate(gameId, (engine) =>
      engine.submitCaption(gameId, playerId, stepId, text, this.now()),
    );
    return this.viewFor(game, playerId);
  }

  async getState(gameId: string, playerId: string): Promise<GameView> {
    const game = await this.mutate(gameId, (engine) => engine.processDeadlines(gameId, this.now()));
    return this.viewFor(game, playerId);
  }

  private async mutate(gameId: string, fn: (engine: GameEngine) => void | Promise<void>): Promise<Game> {
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const loaded = await this.deps.repository.load(gameId);
      if (!loaded) throw new Error(`Game not found: ${gameId}`);
      const before = JSON.stringify(loaded.state);
      const engine = this.engineFor(loaded.state);
      await fn(engine);
      const after = engine.getGame(gameId);
      if (JSON.stringify(after) === before) return after; // no change → no write
      if (await this.deps.repository.save(gameId, after, loaded.version)) return after;
    }
    throw new ConcurrencyError(`Too many concurrent updates for game ${gameId}`);
  }

  private viewFor(game: Game, playerId: string): GameView {
    const engine = this.engineFor(game);
    return { game, pendingTasks: engine.getPendingTasks(game.id, playerId) };
  }
}
