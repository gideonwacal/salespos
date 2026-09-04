import { useCallback, useSyncExternalStore } from "react";
import { getBusiness, subscribeStore, blankBusiness, type Business } from "@/lib/demo";

const server = blankBusiness();

/** Reactive business profile — updates everywhere the moment settings change. */
export function useBusiness(): Business {
  const subscribe = useCallback((fn: () => void) => {
    const unsub = subscribeStore(fn);
    return () => {
      unsub();
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => getBusinessCached(),
    () => server,
  );
}

let cache: { raw: string; value: Business } | null = null;

function getBusinessCached(): Business {
  const value = getBusiness();
  const raw = JSON.stringify(value);
  if (!cache || cache.raw !== raw) cache = { raw, value };
  return cache.value;
}
