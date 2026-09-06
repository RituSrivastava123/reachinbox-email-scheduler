import { useEffect, useState } from "react";
import { api } from "../api/client";

export function SlackConnect() {
  const [connected, setConnected] = useState(false);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const status = await api.slackStatus();
      setConnected(status.connected);
      setTeamName(status.teamName);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (loading) return null;

  if (connected) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">
        <span>Slack connected{teamName ? ` (${teamName})` : ""}</span>
        <button
          className="font-medium underline hover:text-emerald-900"
          onClick={async () => {
            await api.slackDisconnect();
            setConnected(false);
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <a
      href="/api/auth/slack"
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      Connect Slack
    </a>
  );
}
