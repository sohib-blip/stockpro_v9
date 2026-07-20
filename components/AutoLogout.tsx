"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAuthenticationRoute } from "@/lib/auth-routes";
import {
  signOutCurrentDevice,
  STOCKPRO_SESSION_KEY,
  STOCKPRO_SESSION_NOTICE_KEY,
  touchOwnedSession,
} from "@/lib/session-control";

const INACTIVITY_LIMIT = 60 * 60 * 1000; // 1 hour
const SESSION_CHECK_INTERVAL = 30 * 1000; // 30 seconds
const HEARTBEAT_INTERVAL = 60 * 1000; // 1 minute

export default function AutoLogout() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const isAuthRoute = isAuthenticationRoute(pathname);

  useEffect(() => {
    if (isAuthRoute) return;

    const supabase = createSupabaseBrowserClient();

    let inactivityTimer: ReturnType<typeof setTimeout>;
    let sessionChecker: ReturnType<typeof setInterval>;
    let heartbeat: ReturnType<typeof setInterval>;
    let expired = false;
    let stopping = false;

    async function logout(showMessage = false) {
      if (stopping) return;
      stopping = true;
      if (showMessage) expired = true;

      if (showMessage) {
        window.sessionStorage.setItem(
          STOCKPRO_SESSION_NOTICE_KEY,
          "session-expired"
        );
      }

      await signOutCurrentDevice(supabase, window.sessionStorage);

      if (showMessage) {
        router.replace("/login?reason=session-expired");
        router.refresh();
        return;
      }

      router.replace("/login");
      router.refresh();
    }

    function resetTimer() {
      if (expired || stopping) return;

      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => logout(false), INACTIVITY_LIMIT);
    }

    async function checkSession() {
      if (expired || stopping) return;

      const localSessionId =
        window.sessionStorage.getItem(STOCKPRO_SESSION_KEY);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      if (!localSessionId) {
        await logout(false);
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("current_session_id")
        .eq("user_id", user.id)
        .single();

      if (error || !profile) return;

      if (profile.current_session_id !== localSessionId) {
        await logout(true);
      }
    }

    async function updateHeartbeat() {
      if (expired || stopping) return;

      const localSessionId =
        window.sessionStorage.getItem(STOCKPRO_SESSION_KEY);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !localSessionId) return;

      await touchOwnedSession(supabase, user.id, localSessionId);
    }

    const events = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ];

    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();
    checkSession();
    updateHeartbeat();

    sessionChecker = setInterval(checkSession, SESSION_CHECK_INTERVAL);
    heartbeat = setInterval(updateHeartbeat, HEARTBEAT_INTERVAL);

    return () => {
      clearTimeout(inactivityTimer);
      clearInterval(sessionChecker);
      clearInterval(heartbeat);

      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [isAuthRoute, router]);

  return null;
}
