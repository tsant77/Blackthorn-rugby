import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Me } from "./api";

interface SessionState {
  me: Me | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setMe(await api<Me>("/api/me"));
      setError(null);
    } catch (caught) {
      setMe(null);
      setError(caught instanceof ApiError && caught.message !== "Sign in required." ? caught.message : null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return <SessionContext.Provider value={{ me, loading, error, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is missing.");
  return value;
}
