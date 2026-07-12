import { ConcurrencyError } from '../game-service';

export class BadRequestError extends Error {}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Engine guard errors that represent a conflict with current game state.
const GAME_RULE_ERRORS = new Set([
  'need at least 2 players',
  'game already started',
  'not your turn',
  'game is not active',
  'step is not an open caption',
  'game is not in reveal',
]);

export function errorToResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return json({ error: err.message }, 400);
  if (err instanceof ConcurrencyError) return json({ error: 'conflict, please retry' }, 409);
  if (err instanceof Error) {
    if (err.message.startsWith('Game not found')) return json({ error: err.message }, 404);
    if (err.message.startsWith('step not found')) return json({ error: err.message }, 404);
    if (err.message.startsWith('chain not found')) return json({ error: err.message }, 404);
    if (GAME_RULE_ERRORS.has(err.message)) return json({ error: err.message }, 409);
  }
  return json({ error: 'internal error' }, 500);
}
