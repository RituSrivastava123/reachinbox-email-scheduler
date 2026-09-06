import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { ComposeModal } from "../components/ComposeModal";
import { AddSenderModal } from "../components/AddSenderModal";
import { ScheduledTable } from "../components/ScheduledTable";
import { SentTable } from "../components/SentTable";
import { useAuth } from "../hooks/useAuth";
import { api } from "../api/client";
import { PaginatedEmails } from "../types";

type Tab = "scheduled" | "sent";

export function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("scheduled");
  const [composing, setComposing] = useState(false);
  const [addingSender, setAddingSender] = useState(false);

  // Pagination state
  const [scheduledPage, setScheduledPage] = useState(1);
  const [sentPage, setSentPage] = useState(1);

  // Data state
  const [scheduledData, setScheduledData] = useState<PaginatedEmails | null>(null);
  const [sentData, setSentData] = useState<PaginatedEmails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchSource, setSearchSource] = useState<string | null>(null);

  const fetchEmails = async () => {
    setLoading(true);
    setError(null);
    try {
      if (searchQuery.trim() || statusFilter) {
        // Search endpoint (Elasticsearch with Postgres fallback)
        const res = await api.searchEmails(
          searchQuery.trim() || undefined,
          statusFilter || undefined,
          tab === "scheduled" ? scheduledPage : sentPage
        );
        setSearchSource(res.source);
        if (tab === "scheduled") {
          setScheduledData(res);
        } else {
          setSentData(res);
        }
      } else {
        setSearchSource(null);
        const [sched, sent] = await Promise.all([
          api.scheduled(scheduledPage),
          api.sent(sentPage),
        ]);
        setScheduledData(sched);
        setSentData(sent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEmails();
  }, [tab, scheduledPage, sentPage, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchEmails();
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setStatusFilter("");
    setSearchSource(null);
    setTimeout(() => {
      void fetchEmails();
    }, 0);
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        user={user}
        onLogout={logout}
        onCompose={() => setComposing(true)}
        onAddSender={() => setAddingSender(true)}
      />

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Search & Filter Header Bar */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <form onSubmit={handleSearchSubmit} className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by recipient, subject, or body..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-xs shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <svg
                className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="PROCESSING">Processing</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>

            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 transition"
            >
              Search
            </button>
          </form>

          <div className="flex items-center gap-3">
            {searchSource && (
              <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                Source: {searchSource}
              </span>
            )}
            <button
              onClick={() => void fetchEmails()}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50 transition"
              title="Refresh emails"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="mb-4 flex gap-6 border-b border-slate-200">
          <TabButton
            label="Scheduled Emails"
            count={scheduledData?.total}
            active={tab === "scheduled"}
            onClick={() => setTab("scheduled")}
          />
          <TabButton
            label="Sent Emails"
            count={sentData?.total}
            active={tab === "sent"}
            onClick={() => setTab("sent")}
          />
        </div>

        {/* Main Table Card */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm border border-slate-200">
          {tab === "scheduled" ? (
            <ScheduledTable
              data={scheduledData}
              loading={loading}
              error={error}
              page={scheduledPage}
              onPageChange={(p) => setScheduledPage(p)}
              onCancel={async (id) => {
                await api.cancelEmail(id);
                void fetchEmails();
              }}
            />
          ) : (
            <SentTable
              data={sentData}
              loading={loading}
              error={error}
              page={sentPage}
              onPageChange={(p) => setSentPage(p)}
            />
          )}
        </div>
      </main>

      {composing && (
        <ComposeModal
          onClose={() => setComposing(false)}
          onScheduled={() => {
            void fetchEmails();
          }}
        />
      )}

      {addingSender && (
        <AddSenderModal
          onClose={() => setAddingSender(false)}
          onCreated={() => {
            void fetchEmails();
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold transition ${
        active
          ? "border-indigo-600 text-indigo-700"
          : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
