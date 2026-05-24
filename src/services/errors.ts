export class AppError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

export function toAppError(err: unknown, fallback = 'Something went wrong'): AppError {
  if (err instanceof AppError) return err;

  // Supabase / PostgREST surfaces errors as plain objects with { message, details, hint, code }.
  // They are NOT Error instances, so we have to duck-type them or callers see the fallback.
  const obj = err as
    | { message?: string; details?: string | null; hint?: string | null; code?: string }
    | null;
  const supabaseMessage = obj?.message;
  const supabaseDetails = obj?.details;
  const fromError = err instanceof Error ? err.message : null;

  const composed = [supabaseMessage, supabaseDetails].filter(Boolean).join(' — ');
  const message = composed || fromError || fallback;
  const code = obj?.code ?? 'unknown';

  // Helpful in dev — keeps the original error in the console so you can see hint/details.
  if (typeof console !== 'undefined') {
    console.error('[supabase-error]', err);
  }

  return new AppError(code, message, err);
}
