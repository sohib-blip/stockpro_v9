"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";

const INACTIVITY_LIMIT = 60 * 60 * 1000; // 1 hour
const SESSION_CHECK_INTERVAL = 30 * 1000; // 30 seconds

export default function AutoLogout() {
  const router = useRouter();
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    let inactivityTimer: ReturnType<typeof setTimeout>;
    let sessionChecker: ReturnType<typeof setInterval>;
    let expired = false;

    async function logout(showMessage = false) {
      window.sessionStorage.removeItem("stockpro_session_id");

      await supabase.auth.signOut();

      if (showMessage) {
        expired = true;
        setSessionExpired(true);
        return;
      }

      router.replace("/login");
      router.refresh();
    }

    function resetTimer() {
      if (expired) return;

      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => logout(false), INACTIVITY_LIMIT);
    }

    async function checkSession() {
      if (expired) return;

      const localSessionId =
        window.sessionStorage.getItem("stockpro_session_id");

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
        .eq("id", user.id)
        .single();

      if (error || !profile) return;

      if (profile.current_session_id !== localSessionId) {
        await logout(true);
      }
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

    sessionChecker = setInterval(checkSession, SESSION_CHECK_INTERVAL);

    return () => {
      clearTimeout(inactivityTimer);
      clearInterval(sessionChecker);

      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [router]);

  return (
    <ConfirmDialog
      open={sessionExpired}
      title="🔒 Session expired"
      message={
        "Someone has signed in to your account from another device.\n\nFor security reasons, this session has been closed."
      }
      confirmText="Login again"
      cancelText="Close"
      danger
      onConfirm={() => {
        setSessionExpired(false);
        router.replace("/login");
        router.refresh();
      }}
      onCancel={() => {
        setSessionExpired(false);
        router.replace("/login");
        router.refresh();
      }}
    />
  );
}