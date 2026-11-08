import { useEffect, useState } from "react";

/** Capture fragments in memory, including a replacement link opened on the same page. */
export function useLinkToken(): string {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  useEffect(() => {
    function capture() {
      const incoming = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (incoming) setToken(incoming);
      if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
  return token;
}
