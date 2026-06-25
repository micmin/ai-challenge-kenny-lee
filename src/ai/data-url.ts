export interface ParsedDataUrl {
  mediaType: string;
  base64: string;
}

export function toDataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

export function parseDataUrl(value: string): ParsedDataUrl {
  const match = value.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) throw new Error('not a base64 data URL');
  return { mediaType: match[1], base64: match[2] };
}
