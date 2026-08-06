"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { LoginPageWithApply } from "@/components/login-page-with-apply";

const AdminDashboard = dynamic(
  () => import("@/features/admin/admin-dashboard").then((m) => m.AdminDashboard),
  { ssr: false },
);

export default function AdminPage() {
  const router = useRouter();
  const { isLoggedIn, isAdmin } = useAuthStore();
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    restoreSession();
    setSessionReady(true);
  }, [restoreSession]);

  useEffect(() => {
    if (sessionReady && isLoggedIn && !isAdmin) {
      router.replace("/custom-intelligence");
    }
  }, [isAdmin, isLoggedIn, router, sessionReady]);

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA]">
        <div className="rounded-lg border border-[#D9E2EC] bg-white px-5 py-4 text-sm text-[#667085]">
          正在恢复登录状态…
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginPageWithApply />;
  }

  if (!isAdmin) {
    return null;
  }

  return <AdminDashboard onBack={() => router.push("/?view=procurement")} />;
}
