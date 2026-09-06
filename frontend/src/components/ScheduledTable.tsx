import { PaginatedEmails } from "../types";

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "bg-blue-50 text-blue-700",
  PROCESSING: "bg-amber-50 text-amber-700",
};

interface Props {
  data: PaginatedEmails | null;
  loading: boolean;
  error: string | null;
  onCancel: (id: string) => void;
  page?: number;
  onPageChange?: (newPage: number) => void;
}

export function ScheduledTable({ data, loading, error, onCancel, page = 1, onPageChange }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-sm text-slate-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-2" />
        <span>Loading scheduled emails...</span>
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-center text-sm text-red-600">Failed to load: {error}</div>;
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-slate-500">
        No scheduled emails found. Click "Compose Email" to schedule a campaign.
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
            <th className="px-5 py-3">Scheduled At</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.items.map((email) => (
            <tr key={email.id} className="hover:bg-slate-50/80 transition">
              <td className="px-5 py-3.5 font-medium text-slate-900">{email.recipient}</td>
              <td className="px-5 py-3.5 text-slate-700 max-w-xs truncate">{email.subject}</td>
              <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                {new Date(email.scheduledAt).toLocaleString()}
              </td>
              <td className="px-5 py-3.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[email.status] ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${email.status === 'PROCESSING' ? 'bg-amber-500 animate-ping' : 'bg-blue-500'}`} />
                  {email.status}
                </span>
              </td>
              <td className="px-5 py-3.5 text-right">
                {email.status === "SCHEDULED" && (
                  <button
                    onClick={() => onCancel(email.id)}
                    className="rounded border border-red-200 bg-red-50/50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100/80 transition"
                  >
                    Cancel
                  </button>
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
