import { describe, it, expect } from 'vitest';
import { toDataUrl, parseDataUrl } from './data-url';

describe('data-url helpers', () => {
  it('builds a base64 data URL', () => {
    expect(toDataUrl('image/png', 'QUJD')).toBe('data:image/png;base64,QUJD');
  });

  it('round-trips a data URL', () => {
    const url = toDataUrl('image/jpeg', 'Zm9v');
    expect(parseDataUrl(url)).toEqual({ mediaType: 'image/jpeg', base64: 'Zm9v' });
  });

  it('parses base64 payloads that contain "+", "/", and "="', () => {
    const url = toDataUrl('image/png', 'a+b/c==');
    expect(parseDataUrl(url)).toEqual({ mediaType: 'image/png', base64: 'a+b/c==' });
  });

  it('throws on a non-base64 data URL', () => {
    expect(() => parseDataUrl('mock-image://nope')).toThrow('not a base64 data URL');
  });
});
