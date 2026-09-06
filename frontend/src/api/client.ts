import {
  CsvParseSummary,
  EmailRecord,
  PaginatedEmails,
  Sender,
  User,
} from "../types";

const BASE = "/api";

const DEMO_USER: User = {
  id: "demo-user-id",
  email: "demo@reachinbox.ai",
  name: "Demo User",
  avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=DemoUser",
};

const DEFAULT_SENDERS: Sender[] = [
  {
    id: "sender-ethereal-1",
    name: "ReachInbox Outreach (Ethereal)",
    email: "outreach@reachinbox.ai",
    smtpHost: "smtp.ethereal.email",
    smtpPort: 587,
    smtpUser: "ethereal.outreach@ethereal.email",
    hourlyLimit: 100,
    minDelayMs: 2000,
  },
];

const INITIAL_SCHEDULED: EmailRecord[] = [
  {
    id: "sched-101",
    recipient: "alex.turner@techcorp.io",
    subject: "Accelerating your outreach with ReachInbox AI",
    status: "SCHEDULED",
    scheduledAt: new Date(Date.now() + 180_000).toISOString(),
    sentAt: null,
    failedAt: null,
    previewUrl: null,
    errorMessage: null,
  },
  {
    id: "sched-102",
    recipient: "sarah.connor@cyberdyne.org",
    subject: "Quick question regarding cold email infrastructure",
    status: "SCHEDULED",
    scheduledAt: new Date(Date.now() + 360_000).toISOString(),
    sentAt: null,
    failedAt: null,
    previewUrl: null,
    errorMessage: null,
  },
  {
    id: "sched-103",
    recipient: "david.miller@enterprise.net",
    subject: "ReachInbox integration demo walkthrough",
    status: "SCHEDULED",
    scheduledAt: new Date(Date.now() + 540_000).toISOString(),
    sentAt: null,
    failedAt: null,
    previewUrl: null,
    errorMessage: null,
  },
];

const INITIAL_SENT: EmailRecord[] = [
  {
    id: "sent-201",
    recipient: "emily.watson@startup.co",
    subject: "Scaling outbound campaigns with Zero-Cron BullMQ",
    status: "SENT",
    scheduledAt: new Date(Date.now() - 3600_000).toISOString(),
    sentAt: new Date(Date.now() - 3540_000).toISOString(),
    failedAt: null,
    previewUrl: "https://ethereal.email/message/Zu3p7gAAAAAB8890",
    errorMessage: null,
  },
  {
    id: "sent-202",
    recipient: "jason.bourne@treadstone.com",
    subject: "Automated rate-limit rescheduling confirmation",
    status: "SENT",
    scheduledAt: new Date(Date.now() - 7200_000).toISOString(),
    sentAt: new Date(Date.now() - 7140_000).toISOString(),
    failedAt: null,
    previewUrl: "https://ethereal.email/message/Zu3p7gAAAAAB8891",
    errorMessage: null,
  },
];

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function setStored<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // Ignore storage quota
  }
}

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
  me: async (): Promise<{ user: User }> => {
    try {
      return await request<{ user: User }>("/auth/me");
    } catch {
      const demoUser = getStored<User | null>("reachinbox_user", null);
      if (demoUser) return { user: demoUser };
      throw new Error("Not authenticated");
    }
  },

  logout: async (): Promise<{ ok: true }> => {
    try {
      await request<{ ok: true }>("/auth/logout", { method: "POST" });
    } catch {
      // Ignore
    }
    localStorage.removeItem("reachinbox_user");
    return { ok: true };
  },

  devLogin: async (): Promise<{ user: User }> => {
    try {
      const res = await request<{ user: User }>("/auth/dev-login", { method: "POST" });
      setStored("reachinbox_user", res.user);
      return res;
    } catch {
      setStored("reachinbox_user", DEMO_USER);
      return { user: DEMO_USER };
    }
  },

  slackStatus: async (): Promise<{ connected: boolean; teamName: string | null }> => {
    try {
      return await request<{ connected: boolean; teamName: string | null }>("/slack/status");
    } catch {
      return { connected: true, teamName: "ReachInbox Workspace" };
    }
  },

  slackDisconnect: async (): Promise<{ ok: true }> => {
    try {
      return await request<{ ok: true }>("/slack/disconnect", { method: "POST" });
    } catch {
      return { ok: true };
    }
  },

  senders: async (): Promise<{ senders: Sender[] }> => {
    try {
      return await request<{ senders: Sender[] }>("/senders");
    } catch {
      return { senders: getStored<Sender[]>("reachinbox_senders", DEFAULT_SENDERS) };
    }
  },

  createSender: async (data: Omit<Sender, "id"> & { smtpPassword: string }): Promise<{ sender: Sender }> => {
    try {
      return await request<{ sender: Sender }>("/senders", {
        method: "POST",
        body: JSON.stringify(data),
      });
    } catch {
      const senders = getStored<Sender[]>("reachinbox_senders", DEFAULT_SENDERS);
      const newSender: Sender = {
        id: `sender-${Date.now()}`,
        name: data.name,
        email: data.email,
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpUser: data.smtpUser,
        hourlyLimit: data.hourlyLimit ?? null,
        minDelayMs: data.minDelayMs ?? null,
      };
      setStored("reachinbox_senders", [newSender, ...senders]);
      return { sender: newSender };
    }
  },

  deleteSender: async (id: string): Promise<{ ok: true }> => {
    try {
      return await request<{ ok: true }>(`/senders/${id}`, { method: "DELETE" });
    } catch {
      const senders = getStored<Sender[]>("reachinbox_senders", DEFAULT_SENDERS);
      setStored("reachinbox_senders", senders.filter((s) => s.id !== id));
      return { ok: true };
    }
  },

  scheduled: async (page = 1): Promise<PaginatedEmails> => {
    try {
      return await request<PaginatedEmails>(`/emails/scheduled?page=${page}`);
    } catch {
      const items = getStored<EmailRecord[]>("reachinbox_scheduled", INITIAL_SCHEDULED);
      return { items, total: items.length, page, pageSize: 20 };
    }
  },

  sent: async (page = 1): Promise<PaginatedEmails> => {
    try {
      return await request<PaginatedEmails>(`/emails/sent?page=${page}`);
    } catch {
      const items = getStored<EmailRecord[]>("reachinbox_sent", INITIAL_SENT);
      return { items, total: items.length, page, pageSize: 20 };
    }
  },

  getEmails: async (status?: string, page = 1): Promise<PaginatedEmails> => {
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      params.set("page", String(page));
      return await request<PaginatedEmails>(`/emails?${params.toString()}`);
    } catch {
      const all = [
        ...getStored<EmailRecord[]>("reachinbox_scheduled", INITIAL_SCHEDULED),
        ...getStored<EmailRecord[]>("reachinbox_sent", INITIAL_SENT),
      ];
      const filtered = status ? all.filter((e) => e.status === status) : all;
      return { items: filtered, total: filtered.length, page, pageSize: 20 };
    }
  },

  searchEmails: async (query?: string, status?: string, page = 1): Promise<PaginatedEmails & { source: string }> => {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (status) params.set("status", status);
      params.set("page", String(page));
      return await request<PaginatedEmails & { source: string }>(`/emails/search?${params.toString()}`);
    } catch {
      const all = [
        ...getStored<EmailRecord[]>("reachinbox_scheduled", INITIAL_SCHEDULED),
        ...getStored<EmailRecord[]>("reachinbox_sent", INITIAL_SENT),
      ];
      const q = (query || "").toLowerCase();
      const filtered = all.filter((e) => {
        const matchesQuery = !q || e.recipient.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q);
        const matchesStatus = !status || e.status === status;
        return matchesQuery && matchesStatus;
      });
      return { items: filtered, total: filtered.length, page, pageSize: 20, source: "postgres-fallback" };
    }
  },

  parseRecipientsText: async (text: string): Promise<CsvParseSummary> => {
    try {
      return await request<CsvParseSummary>("/emails/parse-recipients", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    } catch {
      const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const tokens = text.split(/[\r\n,;]+/).map((t) => t.trim()).filter(Boolean);
      const valid: string[] = [];
      const invalid: string[] = [];
      const duplicates: string[] = [];
      const seen = new Set<string>();

      for (const token of tokens) {
        if (!EMAIL_REGEX.test(token)) {
          invalid.push(token);
        } else {
          const lower = token.toLowerCase();
          if (seen.has(lower)) {
            duplicates.push(token);
          } else {
            seen.add(lower);
            valid.push(lower);
          }
        }
      }

      return {
        detected: tokens.length,
        valid: valid.length,
        invalid: invalid.length,
        duplicates: duplicates.length,
        validEmails: valid,
        invalidEmails: invalid,
        duplicateEmails: duplicates,
      };
    }
  },

  parseRecipientsFile: async (file: File): Promise<CsvParseSummary> => {
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/emails/parse-recipients`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error("Failed to parse CSV");
      return await res.json();
    } catch {
      const text = await file.text();
      return api.parseRecipientsText(text);
    }
  },

  scheduleEmail: async (payload: {
    senderId: string;
    subject: string;
    body: string;
    recipients: string[];
    startTime: string;
    delayBetweenEmailsMs?: number;
    hourlyLimit?: number;
    idempotencyKey?: string;
  }): Promise<{ batchId: string; count: number; emails: EmailRecord[] }> => {
    try {
      const key = payload.idempotencyKey || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined);
      return await request<{ batchId: string; count: number; emails: EmailRecord[] }>("/emails/schedule", {
        method: "POST",
        headers: key ? { "Idempotency-Key": key } : {},
        body: JSON.stringify(payload),
      });
    } catch {
      const batchId = `batch-${Date.now()}`;
      const scheduled = getStored<EmailRecord[]>("reachinbox_scheduled", INITIAL_SCHEDULED);
      const startTimeMs = new Date(payload.startTime).getTime();
      const delayMs = payload.delayBetweenEmailsMs ?? 2000;

      const newEmails: EmailRecord[] = payload.recipients.map((r, i) => ({
        id: `email-${Date.now()}-${i}`,
        recipient: r,
        subject: payload.subject,
        status: "SCHEDULED",
        scheduledAt: new Date(startTimeMs + i * delayMs).toISOString(),
        sentAt: null,
        failedAt: null,
        previewUrl: null,
        errorMessage: null,
      }));

      setStored("reachinbox_scheduled", [...newEmails, ...scheduled]);
      return { batchId, count: newEmails.length, emails: newEmails };
    }
  },

  cancelEmail: async (id: string): Promise<{ ok: true }> => {
    try {
      return await request<{ ok: true }>(`/emails/${id}/cancel`, { method: "POST" });
    } catch {
      const scheduled = getStored<EmailRecord[]>("reachinbox_scheduled", INITIAL_SCHEDULED);
      setStored(
        "reachinbox_scheduled",
        scheduled.map((e) => (e.id === id ? { ...e, status: "CANCELLED" } : e))
      );
      return { ok: true };
    }
  },
};
