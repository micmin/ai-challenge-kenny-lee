import { createGameService, type GameService } from '../index';

let instance: GameService | null = null;

export function getGameService(): GameService {
  if (!instance) instance = createGameService(process.env as Record<string, string | undefined>);
  return instance;
}
