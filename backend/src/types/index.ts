import { Email, EmailSender, EmailStatus, User } from "@prisma/client";

export type PublicUser = Pick<User, "id" | "name" | "email" | "avatarUrl">;

export type PublicSender = Omit<EmailSender, "smtpPassword">;

export type PublicEmail = Email;

export interface ScheduleEmailRequest {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string; // ISO date string - when the FIRST email should fire
  delayBetweenEmailsMs?: number; // optional override of MIN_EMAIL_DELAY_MS
  hourlyLimit?: number; // optional override of MAX_EMAILS_PER_HOUR for this batch
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

export interface EmailJobData {
  emailId: string;
}

// Extra fields carried on req.user once a session is authenticated.
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
}

export { EmailStatus };
