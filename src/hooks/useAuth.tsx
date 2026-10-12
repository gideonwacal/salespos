import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  isDemo,
  getSessionUser,
  mergeServerBusiness,
  subscribeStore,
  type SessionUser,
  type AppRole,
} from "@/lib/demo";
import { fetchMe, isLive, type MeResponse } from "@/lib/api";
import { businessFrom, signOut as signOutEverywhere } from "@/lib/auth";

export type { AppRole };

type AuthValue = {
  user: SessionUser | null;
  session: SessionUser | null;
  role: AppRole | null;
  fullName: string;
  isOwner: boolean;
  /** The platform owner: no shop of their own, every shop to choose from. */
  isPlatform: boolean;
  /** An owner who has not confirmed their address yet: signed in, but held. */
  needsVerification: boolean;
  demo: boolean;
  /** True when this session is backed by Django rather than local storage. */
  live: boolean;
  loading: boolean;
  signOut: () => void;
  refresh: (known?: MeResponse) => void;
};

const AuthContext = createContext<AuthValue>({
  user: null,
  session: null,
  role: null,
  fullName: "",
  isOwner: false,
  isPlatform: false,
  needsVerification: false,
  demo: false,
  live: false,
  loading: true,
  signOut: () => {},
  refresh: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [demo, setDemo] = useState(false);
  const [live, setLive] = useState(false);
  const [platform, setPlatform] = useState(false);
  const [loading, setLoading] = useState(true);

  /**
   * Re-read who we are.
   *
   * `known` is the answer when the caller has only just received it — signing
   * in already asks the server who you are, and asking twice in a row costs a
   * whole round trip on a connection where that is the slow part.
   */
  const refresh = (known?: MeResponse) => {
    setDemo(isDemo());

    // A held token means the server owns the session; ask it who we are rather
    // than trusting anything in local storage.
    if (isLive() && !isDemo()) {
      setLive(true);
      (known ? Promise.resolve(known) : fetchMe())
        .then((me) => {
          setUser({
            id: me.user.id,
            email: me.user.email,
            full_name: me.user.full_name,
            role: me.role ?? "manager",
            // Older servers do not send it; absent means nothing to confirm.
            email_verified: me.user.email_verified ?? true,
          });

          // The workspace row is the one copy of the business profile, and the
          // owner is the only one who can edit it. Adopting it on every refresh
          // is what puts the owner's logo, tagline and receipt footer in front
          // of the salesperson — otherwise they'd keep whatever was current the
          // day they signed in.
          setPlatform(!!me.platform);
          // Signed in but standing nowhere: the chooser is the only screen
          // that makes sense, and the guard sends them there.
          if (me.active_workspace) {
            mergeServerBusiness(businessFrom(me.active_workspace));
          }
        })
        .catch(() => {
          // Token expired or revoked — drop back to whatever is local.
          setLive(false);
          setUser(getSessionUser());
        })
        .finally(() => setLoading(false));
      return;
    }

    setLive(false);
    setUser(getSessionUser());
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const unsub = subscribeStore(refresh);

    // Coming back to the tab re-asks the server, so a salesperson picks up the
    // owner's change without signing out and in again.
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session: user,
        role: user?.role ?? null,
        fullName: user?.full_name ?? "",
        isOwner: user?.role === "owner",
        isPlatform: platform,
        // Only ever asked of an owner. A cashier was vouched for by whoever
        // created their login and has no address of their own on file.
        needsVerification: user?.role === "owner" && user?.email_verified === false,
        demo,
        live,
        loading,
        signOut: () => {
          signOutEverywhere();
          setUser(null);
          setLive(false);
        },
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
