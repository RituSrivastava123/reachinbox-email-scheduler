import { parse } from "csv-parse/sync";
import { CsvParseSummary } from "../types";

// Deliberately conservative but practical email regex (RFC 5322 "good enough").
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Accepts either a raw CSV buffer/string or newline/comma separated plain
 * text and returns every "cell" as a candidate email address. We don't
 * assume a header row: any column that looks like an email is taken, so
 * both `email\nfoo@bar.com` and a bare list of addresses work.
 */
function extractCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let rows: string[][];
  try {
    rows = parse(trimmed, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  } catch {
    // Not valid CSV -- fall back to treating the whole thing as freeform text.
    rows = trimmed
      .split(/[\r\n,;]+/)
      .map((cell) => [cell]);
  }

  const candidates: string[] = [];
  for (const row of rows) {
    for (const cell of row) {
      const value = (cell ?? "").trim();
      if (value) candidates.push(value);
    }
  }
  return candidates;
}

export function parseRecipients(raw: string): CsvParseSummary {
  const candidates = extractCandidates(raw);

  const seen = new Set<string>();
  const validEmails: string[] = [];
  const invalidEmails: string[] = [];
  const duplicateEmails: string[] = [];

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();

    if (!EMAIL_REGEX.test(normalized)) {
      // Skip obvious header labels like "email" / "recipient" silently rather
      // than flagging them as invalid noise.
      if (["email", "recipient", "address", "recipients"].includes(normalized)) continue;
      invalidEmails.push(candidate);
      continue;
    }

    if (seen.has(normalized)) {
      duplicateEmails.push(candidate);
      continue;
    }

    seen.add(normalized);
    validEmails.push(normalized);
  }

  return {
    detected: candidates.length,
    valid: validEmails.length,
    invalid: invalidEmails.length,
    duplicates: duplicateEmails.length,
    validEmails,
    invalidEmails,
    duplicateEmails,
  };
}
