import type { Game } from '../engine/index';

export interface LoadedGame {
  state: Game;
  version: number;
}

export interface GameRepository {
  load(id: string): Promise<LoadedGame | null>;
  insert(game: Game): Promise<void>;
  /** Returns false when `expectedVersion` no longer matches (concurrency conflict). */
  save(id: string, state: Game, expectedVersion: number): Promise<boolean>;
}

export class InMemoryGameRepository implements GameRepository {
  private rows = new Map<string, LoadedGame>();

  async load(id: string): Promise<LoadedGame | null> {
    const row = this.rows.get(id);
    return row ? { state: structuredClone(row.state), version: row.version } : null;
  }

  async insert(game: Game): Promise<void> {
    this.rows.set(game.id, { state: structuredClone(game), version: 0 });
  }

  async save(id: string, state: Game, expectedVersion: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.version !== expectedVersion) return false;
    this.rows.set(id, { state: structuredClone(state), version: expectedVersion + 1 });
    return true;
  }
}
