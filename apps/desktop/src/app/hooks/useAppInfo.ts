import { useEffect, useState } from "react";
import type { AppInfo } from "@cmp/shared-types";

type State =
  | { status: "loading" }
  | { status: "ready"; info: AppInfo }
  | { status: "error"; message: string };

export function useAppInfo(): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    window.cmp.app.info().then(
      (result) => {
        if (cancelled) return;
        setState(
          result.success
            ? { status: "ready", info: result.data }
            : { status: "error", message: result.error.message },
        );
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", message: String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
