// Turns an unknown thrown value into a useful message. Supabase errors are plain
// objects whose `String(...)` is "[object Object]", which hides `.message`/`.code`.
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}
