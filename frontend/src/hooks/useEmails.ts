import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { PaginatedEmails } from "../types";

type Kind = "scheduled" | "sent";

export function useEmails(kind: Kind, page: number) {
  const [data, setData] = useState<PaginatedEmails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = kind === "scheduled" ? await api.scheduled(page) : await api.sent(page);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [kind, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}
