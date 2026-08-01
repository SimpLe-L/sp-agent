export const apiBase = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:4317/api";

export async function apiHeaders(init?: HeadersInit): Promise<Headers> {
  const desktop = window.spAgentDesktop;
  const token = desktop ? await desktop.getApiToken() : undefined;
  const headers = new Headers(init);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await apiHeaders(init?.headers);
  const res = await fetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}
