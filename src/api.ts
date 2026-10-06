import type { Data } from "./types";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  // Requisições que gravam (POST/PUT/PATCH/DELETE) sempre enviam JSON: o servidor recusa corpo sem Content-Type JSON (proteção CSRF).
  const write = method !== "GET";
  const res = await fetch(url, { method, headers: write ? { "Content-Type": "application/json" } : undefined, body: write ? JSON.stringify(body ?? {}) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? "Erro inesperado");
  return json as T;
}

export const api = {
  session: () => call<{ authenticated: boolean }>("GET", "/api/session"),
  login: (username: string, password: string) => call("POST", "/api/login", { username, password }),
  changePassword: (currentPassword: string, newPassword: string) => call("POST", "/api/change-password", { currentPassword, newPassword }),
  logout: () => call("POST", "/api/logout"),
  data: () => call<Data>("GET", "/api/data"),
  create: (t: string, b: unknown) => call<{ id: number }>("POST", `/api/${t}`, b),
  update: (t: string, id: number, b: unknown) => call("PATCH", `/api/${t}/${id}`, b),
  remove: (t: string, id: number) => call("DELETE", `/api/${t}/${id}`),
  post: (url: string, b?: unknown) => call("POST", `/api/${url}`, b ?? {}),
  put: (url: string, b: unknown) => call("PUT", `/api/${url}`, b),
  del: (url: string) => call("DELETE", `/api/${url}`),
  secret: () => call<{ secret: string }>("GET", "/api/webhook-secret"),
};
