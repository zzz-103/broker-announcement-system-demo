function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return trimmed.replace(/\/api$/i, "");
}

const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export function getApiBaseUrlLabel(): string {
  return API_BASE_URL || "当前页面同源 /api";
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError")
  );
}

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
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        const payload = item as { loc?: unknown; msg?: unknown };
        const message = typeof payload.msg === "string" ? payload.msg : "";
        const location = Array.isArray(payload.loc)
          ? payload.loc.filter((part): part is string | number => typeof part === "string" || typeof part === "number").join(".")
          : "";
        return location && message ? `${location}: ${message}` : message;
      }).filter(Boolean);
      return messages.length ? messages.join("；") : "请求参数有误";
    }
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
    if (isAbortError(error)) throw error;
    throw new BackendApiError("无法访问后端 API", 0);
  }
  if (!response.ok) throw new BackendApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

/** POST a raw request body (for example an application/zip upload) and parse JSON. */
export async function requestBodyJson<T>(
  path: string,
  body: BodyInit,
  token?: string,
  signal?: AbortSignal,
  contentType = "application/octet-stream",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      method: "POST",
      body,
      signal,
      cache: "no-store",
      headers: {
        "Content-Type": contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new BackendApiError("无法访问后端 API", 0);
  }
  if (!response.ok) throw new BackendApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

export async function requestBlob(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<{ blob: Blob; headers: Headers }> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      cache: init.cache ?? "no-store",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new BackendApiError("无法访问后端 API", 0);
  }
  if (!response.ok) throw new BackendApiError(await readError(response), response.status);
  return { blob: await response.blob(), headers: response.headers };
}
