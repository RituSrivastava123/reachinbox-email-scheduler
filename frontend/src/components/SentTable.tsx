import { PaginatedEmails } from "../types";

const STATUS_STYLES: Record<string, string> = {
  SENT: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
};

interface Props {
  data: PaginatedEmails | null;
  loading: boolean;
  error: string | null;
  page?: number;
  onPageChange?: (newPage: number) => void;
}

export function SentTable({ data, loading, error, page = 1, onPageChange }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-sm text-slate-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-2" />
        <span>Loading sent emails...</span>
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-center text-sm text-red-600">Failed to load: {error}</div>;
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-slate-500">
        No sent emails found yet.
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / data.pageSize) || 1;

  return (
    <div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-5 py-3">Recipient</th>
            <th className="px-5 py-3">Subject</th>
            <th className="px-5 py-3">Completed At</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3 text-right">Ethereal Inbox</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.items.map((email) => (
            <tr key={email.id} className="hover:bg-slate-50/80 transition">
              <td className="px-5 py-3.5 font-medium text-slate-900">{email.recipient}</td>
              <td className="px-5 py-3.5 text-slate-700 max-w-xs truncate">{email.subject}</td>
              <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                {email.sentAt
                  ? new Date(email.sentAt).toLocaleString()
                  : email.failedAt
                  ? new Date(email.failedAt).toLocaleString()
                  : "-"}
              </td>
              <td className="px-5 py-3.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[email.status] ?? "bg-slate-100 text-slate-600"
                  }`}
                  title={email.errorMessage ?? undefined}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      email.status === "SENT"
                        ? "bg-emerald-500"
                        : email.status === "FAILED"
                        ? "bg-red-500"
                        : "bg-slate-400"
                    }`}
                  />
                  {email.status}
                </span>
              </td>
              <td className="px-5 py-3.5 text-right">
                {email.previewUrl ? (
                  <a
                    href={email.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50/60 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100/80 transition"
                  >
                    <span>View Inbox</span>
                    <span>↗</span>
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 bg-white text-xs text-slate-500">
          <span>
            Showing {(data.page - 1) * data.pageSize + 1} to{" "}
            {Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange && onPageChange(data.page - 1)}
              disabled={data.page <= 1}
              className="rounded border border-slate-300 px-3 py-1 font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="self-center font-medium text-slate-700">
              {data.page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange && onPageChange(data.page + 1)}
              disabled={data.page >= totalPages}
              className="rounded border border-slate-300 px-3 py-1 font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
