import type { GameServicePort } from '../game-service';
import { BadRequestError, errorToResponse, json } from './responses';

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    throw new BadRequestError('invalid JSON body');
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`${field} is required`);
  }
  return value;
}

export async function createGameHandler(service: GameServicePort, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const hostName = requireString(body.hostName, 'hostName');
    const turnDeadlineMs = body.turnDeadlineMs;
    if (typeof turnDeadlineMs !== 'number' || turnDeadlineMs <= 0) {
      throw new BadRequestError('turnDeadlineMs must be a positive number');
    }
    return json(await service.createGame(hostName, turnDeadlineMs), 201);
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function joinGameHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const name = requireString(body.name, 'name');
    return json(await service.joinGame(gameId, name));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function startGameHandler(service: GameServicePort, gameId: string, _request: Request): Promise<Response> {
  try {
    return json(await service.startGame(gameId));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function getStateHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const playerId = new URL(request.url).searchParams.get('playerId');
    if (!playerId) throw new BadRequestError('playerId query parameter is required');
    return json(await service.getState(gameId, playerId));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function submitCaptionHandler(service: GameServicePort, gameId: string, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const playerId = requireString(body.playerId, 'playerId');
    const stepId = requireString(body.stepId, 'stepId');
    const text = requireString(body.text, 'text');
    return json(await service.submitCaption(gameId, playerId, stepId, text));
  } catch (err) {
    return errorToResponse(err);
  }
}
