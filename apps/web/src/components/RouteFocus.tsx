import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

// A new screen starts below the safe-area header, rather than inheriting a long
// workout form's scroll position. Fragments are credentials on auth pages, not anchors.
export function RouteFocus() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const frame = requestAnimationFrame(() => {
      const main = document.querySelector("main");
      main?.setAttribute("tabindex", "-1");
      main?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  return null;
}
