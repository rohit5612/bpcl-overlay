const ORIGIN_STORAGE = "bpc_admin_api_origin";
const TOKEN_STORAGE = "bpc_broadcast_token";

export function saveConnection(origin: string, token: string) {
  sessionStorage.setItem(ORIGIN_STORAGE, origin);
  sessionStorage.setItem(TOKEN_STORAGE, token);
}

export function loadConnection(): { origin: string; token: string } {
  return {
    origin:
      sessionStorage.getItem(ORIGIN_STORAGE) ??
      import.meta.env.VITE_ADMIN_API_ORIGIN ??
      import.meta.env.VITE_BROADCAST_API_ORIGIN ??
      "http://127.0.0.1:8080",
    token: sessionStorage.getItem(TOKEN_STORAGE) ?? "",
  };
}

/** Extract a human-readable message from broadcast-api JSON error bodies. */
export function formatApiErrorBody(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: string; code?: string };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* plain text */
  }
  return text.slice(0, 400);
}

export async function apiFetch(
  origin: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}
