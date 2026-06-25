import { describe, it, expect } from 'vitest';
import { uuidIdGenerator } from './id-generator';

describe('uuidIdGenerator', () => {
  it('prefixes and produces unique ids', () => {
    const a = uuidIdGenerator('s');
    const b = uuidIdGenerator('s');
    expect(a.startsWith('s_')).toBe(true);
    expect(a).not.toBe(b);
  });
});
