/**
 * Typed fetch wrapper for Padvik API.
 * All API responses follow { success: boolean, data?: T, error?: { code, message } }.
 */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);

  const body = await res.json();

  if (!body.success) {
    throw new ApiError(
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? "An error occurred",
      res.status,
    );
  }

  return body.data as T;
}
