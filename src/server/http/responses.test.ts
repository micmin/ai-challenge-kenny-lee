import { describe, it, expect } from 'vitest';
import { json, BadRequestError, errorToResponse } from './responses';
import { ConcurrencyError } from '../game-service';

describe('json', () => {
  it('serializes a body with a status and JSON content-type', async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('defaults to status 200', () => {
    expect(json({}).status).toBe(200);
  });
});

describe('errorToResponse', () => {
  it('maps BadRequestError to 400', async () => {
    const res = errorToResponse(new BadRequestError('name is required'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'name is required' });
  });

  it('maps a "Game not found" error to 404', () => {
    expect(errorToResponse(new Error('Game not found: g1')).status).toBe(404);
  });

  it('maps ConcurrencyError to 409', () => {
    expect(errorToResponse(new ConcurrencyError('too many')).status).toBe(409);
  });

  it('maps engine guard errors to 409 with their message', async () => {
    const res = errorToResponse(new Error('not your turn'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not your turn' });
  });

  it('maps unknown errors to 500 without leaking the message', async () => {
    const res = errorToResponse(new Error('kaboom internal detail'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal error' });
  });
});
