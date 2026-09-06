import nodemailer, { Transporter } from "nodemailer";
import { config } from "../../config";
import { logger } from "../../utils/logger";

const transporterCache = new Map<string, Promise<Transporter>>();
let fallbackTransporterPromise: Promise<Transporter> | null = null;

/**
 * Builds (and caches) a real Nodemailer SMTP transporter for a given sender's
 * own SMTP credentials, as stored on the EmailSender row -- this is what
 * requirement 9 ("Ethereal SMTP credentials must be configurable [per
 * sender]") actually means: every sender can point at its own Ethereal test
 * inbox instead of a single hardcoded one.
 */
export function getTransporterForSender(sender: {
  id: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
}): Promise<Transporter> {
  const cached = transporterCache.get(sender.id);
  if (cached) return cached;

  const built = Promise.resolve(
    nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: false,
      auth: { user: sender.smtpUser, pass: sender.smtpPassword },
    })
  );
  transporterCache.set(sender.id, built);
  return built;
}

/**
 * Fallback transporter used only when a sender was created without explicit
 * SMTP credentials. Auto-provisions a disposable Ethereal test account on
 * first use (real SMTP account, real inbox -- not mocked) and logs the
 * credentials so they can be copied into .env / the sender row to persist
 * across restarts.
 */
async function getFallbackTransporter(): Promise<Transporter> {
  if (!fallbackTransporterPromise) {
    fallbackTransporterPromise = (async () => {
      let user = config.ethereal.user;
      let pass = config.ethereal.pass;

      if (!user || !pass) {
        const testAccount = await nodemailer.createTestAccount();
        user = testAccount.user;
        pass = testAccount.pass;
        logger.warn(
          { user, pass },
          "No ETHEREAL_USER/ETHEREAL_PASS set -- generated a temporary Ethereal account. " +
            "Copy these into your .env or into a sender row to reuse the same inbox across restarts."
        );
      }

      return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user, pass },
      });
    })();
  }
  return fallbackTransporterPromise;
}

async function getTransporter(sender?: {
  id: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
}): Promise<Transporter> {
  if (sender && sender.smtpHost && sender.smtpUser && sender.smtpPassword) {
    return getTransporterForSender(sender);
  }
  return getFallbackTransporter();
}

export interface SendResult {
  messageId: string;
  previewUrl: string | undefined;
}

export async function sendEmail(params: {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  html: string;
  sender?: {
    id: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
  };
}): Promise<SendResult> {
  const transporter = await getTransporter(params.sender);

  const info = await transporter.sendMail({
    from: `"${params.fromName}" <${params.fromEmail}>`,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;

  return { messageId: info.messageId, previewUrl };
}
