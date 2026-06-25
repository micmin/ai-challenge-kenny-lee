import type { Game } from '../engine/index';
import type { GameRepository, LoadedGame } from './game-repository';
import { describeError } from './describe-error';

interface GameRow {
  id: string;
  state: Game;
  version: number;
}

// Minimal shape of the Supabase client this repository uses. The real
// SupabaseClient satisfies it structurally; it's cast at the wiring boundary.
export interface GamesTableClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): Promise<{ data: GameRow | null; error: unknown }>;
      };
    };
    insert(row: GameRow): Promise<{ error: unknown }>;
    update(row: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          select(columns: string): Promise<{ data: Array<{ id: string }> | null; error: unknown }>;
        };
      };
    };
  };
}

export class SupabaseGameRepository implements GameRepository {
  constructor(private readonly client: GamesTableClient, private readonly table = 'games') {}

  async load(id: string): Promise<LoadedGame | null> {
    const { data, error } = await this.client.from(this.table).select('id, state, version').eq('id', id).maybeSingle();
    if (error) throw new Error(`load failed: ${describeError(error)}`);
    return data ? { state: data.state, version: data.version } : null;
  }

  async insert(game: Game): Promise<void> {
    const { error } = await this.client.from(this.table).insert({ id: game.id, state: game, version: 0 });
    if (error) throw new Error(`insert failed: ${describeError(error)}`);
  }

  async save(id: string, state: Game, expectedVersion: number): Promise<boolean> {
    const { data, error } = await this.client
      .from(this.table)
      .update({ state, version: expectedVersion + 1, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('version', expectedVersion)
      .select('id');
    if (error) throw new Error(`save failed: ${describeError(error)}`);
    return (data ?? []).length > 0;
  }
}
