/**
 * Execute a function with best-effort error handling.
 *
 * For sync functions, catches thrown exceptions.
 * For async functions (returning a Promise), catches rejections.
 * Errors are logged to stderr with a label for debugging.
 */
export function fireAndForget(label: string, fn: () => unknown): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[grove] ${label} failed: ${message}\n`);
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[grove] ${label} failed: ${message}\n`);
  }
}
