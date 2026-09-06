import { useState } from "react";
import { api } from "../api/client";
import { Sender } from "../types";

interface Props {
  onClose: () => void;
  onCreated: (sender: Sender) => void;
}

export function AddSenderModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState<number | "">(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [hourlyLimit, setHourlyLimit] = useState<number | "">("");
  const [minDelayMs, setMinDelayMs] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fillEtherealDefaults = () => {
    setName("Test Sender");
    setEmail("tester@ethereal.email");
    setSmtpHost("smtp.ethereal.email");
    setSmtpPort(587);
    setSmtpUser("testuser@ethereal.email");
    setSmtpPassword("testpass123");
    setHourlyLimit(100);
    setMinDelayMs(1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name || !email || !smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
      setError("Please fill in all required SMTP fields.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createSender({
        name,
        email,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpUser,
        smtpPassword,
        hourlyLimit: hourlyLimit === "" ? null : Number(hourlyLimit),
        minDelayMs: minDelayMs === "" ? null : Number(minDelayMs),
      });
      onCreated(res.sender);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create sender");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add New Email Sender</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={fillEtherealDefaults}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            ⚡ Auto-fill with Ethereal test settings
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Display Name *</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Marketing Team"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">From Email *</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="news@company.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">SMTP Host *</label>
              <input
                required
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.ethereal.email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Port *</label>
              <input
                required
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="587"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">SMTP Username *</label>
              <input
                required
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="smtp-user"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">SMTP Password *</label>
              <input
                required
                type="password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Hourly Limit (optional)</label>
              <input
                type="number"
                min={1}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="e.g. 200"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Min Delay (ms, optional)</label>
              <input
                type="number"
                min={0}
                value={minDelayMs}
                onChange={(e) => setMinDelayMs(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="e.g. 2000"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="mt-5 flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Save Sender"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
