/**
 * In-memory progress tracking for school imports.
 * Shared across requests in the same process.
 */

export const importProgress: Record<string, {
  running: boolean;
  source: string;
  startedAt: number;
  message: string;
  inserted: number;
  updated: number;
  errors: number;
  durationMs?: number;
}> = {};
