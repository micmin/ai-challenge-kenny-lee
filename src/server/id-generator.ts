import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../engine/index';

// Globally-unique ids so a fresh engine resuming a persisted game never
// re-mints an existing id (the per-request counter would otherwise collide).
export const uuidIdGenerator: IdGenerator = (prefix) => `${prefix}_${randomUUID()}`;
