import { useEffect, useState } from "react";
import { api } from "../api/client";
import { CsvParseSummary, Sender } from "../types";
import { AddSenderModal } from "./AddSenderModal";

interface Props {
  onClose: () => void;
  onScheduled: () => void;
}

export function ComposeModal({ onClose, onScheduled }: Props) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [summary, setSummary] = useState<CsvParseSummary | null>(null);
  const [startTime, setStartTime] = useState("");
  const [delayMs, setDelayMs] = useState<number | "">("");
  const [hourlyLimit, setHourlyLimit] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [addingSender, setAddingSender] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.senders().then((res) => {
      setSenders(res.senders);
      if (res.senders[0]) setSenderId(res.senders[0].id);
    });
  }, []);

  const parseText = async (text: string) => {
    setRecipientsText(text);
    if (!text.trim()) {
      setSummary(null);
      return;
    }
    const result = await api.parseRecipientsText(text);
    setSummary(result);
  };

  const parseFile = async (file: File) => {
    const result = await api.parseRecipientsFile(file);
    setSummary(result);
    setRecipientsText(result.validEmails.join("\n"));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!senderId || !subject || !body || !summary || summary.valid === 0 || !startTime) {
      setError("Please fill in all fields and provide at least one valid recipient.");
      return;
    }

    setSubmitting(true);
    try {
      await api.scheduleEmail({
        senderId,
        subject,
        body,
        recipients: summary.validEmails,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmailsMs: delayMs === "" ? undefined : delayMs,
        hourlyLimit: hourlyLimit === "" ? undefined : hourlyLimit,
      });
      onScheduled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule emails");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Compose New Email</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700">Sender</label>
              <button
                type="button"
                onClick={() => setAddingSender(true)}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                + Add New Sender
              </button>
            </div>
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {senders.length === 0 && <option value="">No senders configured yet</option>}
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} &lt;{s.email}&gt;
                </option>
              ))}
            </select>
            {senders.length === 0 && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                <span>No senders found. Add one to schedule emails.</span>
                <button
                  type="button"
                  onClick={() => setAddingSender(true)}
                  className="ml-2 font-semibold underline"
                >
                  Create Sender
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Quarterly product update"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="HTML or plain text body"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Recipients (CSV upload or paste emails)
            </label>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])}
              className="mb-2 block text-sm"
            />
            <textarea
              value={recipientsText}
              onChange={(e) => parseText(e.target.value)}
              rows={4}
              placeholder="alice@example.com, bob@example.com ..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {summary && (
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                <Stat label="Detected" value={summary.detected} />
                <Stat label="Valid" value={summary.valid} tone="text-emerald-700" />
                <Stat label="Invalid" value={summary.invalid} tone="text-red-600" />
                <Stat label="Duplicates" value={summary.duplicates} tone="text-amber-600" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Start time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Delay between emails (ms)
              </label>
              <input
                type="number"
                min={0}
                value={delayMs}
                onChange={(e) => setDelayMs(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="Default from server config"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Hourly limit</label>
              <input
                type="number"
                min={1}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="Default from server config"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>

      {addingSender && (
        <AddSenderModal
          onClose={() => setAddingSender(false)}
          onCreated={(newSender) => {
            setSenders((prev) => [...prev, newSender]);
            setSenderId(newSender.id);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className={`text-base font-semibold ${tone ?? "text-slate-900"}`}>{value}</div>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}
