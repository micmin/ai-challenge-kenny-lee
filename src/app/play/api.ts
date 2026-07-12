import type { Game, Step } from '../../engine/index';

export interface GameView {
  game: Game;
  pendingTasks: Step[];
}

export interface StepResult {
  view: GameView;
  filled: boolean;
  authorName: string | null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function createSolo(seed: string, aiCount: number): Promise<{ gameId: string; hostId: string; view: GameView }> {
  return postJson('/api/games/solo', { seed, aiCount });
}

export function stepAi(gameId: string, playerId: string): Promise<StepResult> {
  return postJson(`/api/games/${gameId}/step`, { playerId });
}

export function submitCaption(gameId: string, playerId: string, stepId: string, text: string): Promise<GameView> {
  return postJson(`/api/games/${gameId}/captions`, { playerId, stepId, text });
}

export function pickWinner(gameId: string, chainId: string): Promise<Game> {
  return postJson(`/api/games/${gameId}/vote`, { chainId });
}
