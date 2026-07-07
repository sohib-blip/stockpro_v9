"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const INACTIVITY_LIMIT = 60 * 60 * 1000; // 1 hour

export default function AutoLogout() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    let timer: ReturnType<typeof setTimeout>;

    async function logout() {
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    }

    function resetTimer() {
      clearTimeout(timer);
      timer = setTimeout(logout, INACTIVITY_LIMIT);
    }

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];

    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [router]);

  return null;
}