import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";

export function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [devLoading, setDevLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const errorParam = searchParams.get("error");

  const handleDevLogin = async () => {
    setDevLoading(true);
    setErrorMsg(null);
    try {
      await api.devLogin();
      window.location.href = "/dashboard";
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to log in with dev account");
      setDevLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-slate-100">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-xl shadow-md shadow-indigo-100">
          R
        </div>
        <h1 className="text-center text-2xl font-bold text-slate-900">ReachInbox</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Production-grade email campaign scheduler & queue engine
        </p>

        {errorParam === "oauth_unconfigured" && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 border border-amber-200">
            Google OAuth is not configured in .env on this server. You can click <strong>Demo Account Sign In</strong> below to evaluate all features.
          </div>
        )}

        {errorParam === "google" && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
            Google authentication failed. Please try again.
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
            {errorMsg}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-400"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Continue with Google
          </a>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-400">or evaluate instantly</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDevLogin}
            disabled={devLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {devLoading ? (
              <span>Signing in...</span>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Quick Demo Sign In</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
          ReachInbox Assignment • Full Stack TypeScript + BullMQ
        </div>
      </div>
    </div>
  );
}
