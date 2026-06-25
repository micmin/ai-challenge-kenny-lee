import type { Game } from './types';

export class GameStore {
  private games = new Map<string, Game>();

  save(game: Game): void {
    this.games.set(game.id, game);
  }

  has(id: string): boolean {
    return this.games.has(id);
  }

  get(id: string): Game {
    const game = this.games.get(id);
    if (!game) throw new Error(`Game not found: ${id}`);
    return game;
  }
}
