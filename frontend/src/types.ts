export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  hourlyLimit: number | null;
  minDelayMs: number | null;
}

export type EmailStatus = "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";

export interface EmailRecord {
  id: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  previewUrl: string | null;
  errorMessage: string | null;
}

export interface PaginatedEmails {
  items: EmailRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CsvParseSummary {
  detected: number;
  valid: number;
  invalid: number;
  duplicates: number;
  validEmails: string[];
  invalidEmails: string[];
  duplicateEmails: string[];
}
