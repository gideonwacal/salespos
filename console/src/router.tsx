import { useEffect, useState, type AnchorHTMLAttributes } from "react";

/**
 * A tiny hash router. Hash URLs (#/businesses/…) need no server rewrite rules,
 * so the console deploys to any static host as-is.
 */

export type Location = { path: string; query: URLSearchParams };

function current(): Location {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, search = ""] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(search) };
}

export function useLocation() {
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const update = () => {
      setLocation(current());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return location;
}

export function href(path: string, query: Record<string, string | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
  const text = search.toString();
  return `#${path}${text ? `?${text}` : ""}`;
}

export function go(path: string, query: Record<string, string | undefined> = {}) {
  window.location.hash = href(path, query);
}

export function Link({
  to,
  query,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  query?: Record<string, string | undefined>;
}) {
  return <a href={href(to, query)} {...props} />;
}
