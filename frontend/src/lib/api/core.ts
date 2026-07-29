function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return trimmed.replace(/\/api$/i, "");
}

const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export class BackendApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BackendApiError";
  }
}

export class SseParseError extends Error {
  constructor(message: string, public readonly rawEvent: string) {
    super(message);
    this.name = "SseParseError";
  }
}

export async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown; error?: unknown };
    const detail = data.detail ?? data.error;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const payload = detail as { message?: unknown; meta?: unknown };
      const message = typeof payload.message === "string" ? payload.message : response.statusText;
      return payload.meta ? `${message}: ${JSON.stringify(payload.meta)}` : message;
    }
    return response.statusText;
  } catch {
    return response.statusText || "Request failed";
  }
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      cache: init.cache ?? "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new BackendApiError(error instanceof Error ? error.message : "Cannot connect to backend", 0);
  }
  if (!response.ok) throw new BackendApiError(await readError(response), response.status);
  return (await response.json()) as T;
}
