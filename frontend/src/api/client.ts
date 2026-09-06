import {
  CsvParseSummary,
  EmailRecord,
  PaginatedEmails,
  Sender,
  User,
} from "../types";

const BASE = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>("/auth/me"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  devLogin: () => request<{ user: User }>("/auth/dev-login", { method: "POST" }),

  slackStatus: () => request<{ connected: boolean; teamName: string | null }>("/slack/status"),
  slackDisconnect: () => request<{ ok: true }>("/slack/disconnect", { method: "POST" }),

  senders: () => request<{ senders: Sender[] }>("/senders"),
  createSender: (data: Omit<Sender, "id"> & { smtpPassword: string }) =>
    request<{ sender: Sender }>("/senders", { method: "POST", body: JSON.stringify(data) }),
  deleteSender: (id: string) => request<{ ok: true }>(`/senders/${id}`, { method: "DELETE" }),

  scheduled: (page = 1) => request<PaginatedEmails>(`/emails/scheduled?page=${page}`),
  sent: (page = 1) => request<PaginatedEmails>(`/emails/sent?page=${page}`),
  getEmails: (status?: string, page = 1) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("page", String(page));
    return request<PaginatedEmails>(`/emails?${params.toString()}`);
  },
  searchEmails: (query?: string, status?: string, page = 1) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    params.set("page", String(page));
    return request<PaginatedEmails & { source: string }>(`/emails/search?${params.toString()}`);
  },

  parseRecipientsText: (text: string) =>
    request<CsvParseSummary>("/emails/parse-recipients", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  parseRecipientsFile: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/emails/parse-recipients`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) throw new Error("Failed to parse CSV");
    return res.json() as Promise<CsvParseSummary>;
  },

  scheduleEmail: (payload: {
    senderId: string;
    subject: string;
    body: string;
    recipients: string[];
    startTime: string;
    delayBetweenEmailsMs?: number;
    hourlyLimit?: number;
    idempotencyKey?: string;
  }) => {
    const key =
      payload.idempotencyKey ||
      (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined);
    return request<{ batchId: string; count: number; emails: EmailRecord[] }>("/emails/schedule", {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : {},
      body: JSON.stringify(payload),
    });
  },

  cancelEmail: (id: string) => request<{ ok: true }>(`/emails/${id}/cancel`, { method: "POST" }),
};
