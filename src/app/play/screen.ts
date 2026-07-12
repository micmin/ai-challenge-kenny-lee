import type { Game, Step } from '../../engine/index';

export type Screen = 'start' | 'yourTurn' | 'reveal' | 'done';

export function deriveScreen(game: Game): Screen {
  if (game.status === 'reveal' || game.status === 'voting') return 'reveal';
  if (game.status === 'done') return 'done';
  return 'yourTurn';
}

export function imageForTask(game: Game, task: Step): string | null {
  const chain = game.chains.find((c) => c.id === task.chainId);
  if (!chain) return null;
  const image = chain.steps.find((s) => s.type === 'image' && s.position === task.position - 1);
  return image ? image.content : null;
}

export function roundOf(task: Step): number {
  return Math.floor(task.position / 2) + 1;
}
