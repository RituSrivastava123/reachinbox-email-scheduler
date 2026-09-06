import { User } from "../types";
import { SlackConnect } from "./SlackConnect";

interface Props {
  user: User;
  onLogout: () => void;
  onCompose: () => void;
  onAddSender?: () => void;
}

export function Header({ user, onLogout, onCompose, onAddSender }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-lg shadow-sm">
          R
        </div>
        <div className="flex flex-col">
          <span className="text-base font-bold text-slate-900 tracking-tight">ReachInbox</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Scheduler</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <a
          href="/admin/queues"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition"
          title="Open BullMQ Queue Monitor Dashboard"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Bull Board</span>
        </a>

        <SlackConnect />

        {onAddSender && (
          <button
            onClick={onAddSender}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            + Add Sender
          </button>
        )}

        <button
          onClick={onCompose}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
        >
          Compose Email
        </button>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="text-sm leading-tight">
            <div className="font-medium text-slate-900">{user.name}</div>
            <div className="text-slate-500">{user.email}</div>
          </div>
          <button
            onClick={onLogout}
            className="ml-2 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
