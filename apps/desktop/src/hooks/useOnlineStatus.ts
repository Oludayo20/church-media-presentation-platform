import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Network status for the offline indicator (DOCUMENTATION.md §9.5). */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
