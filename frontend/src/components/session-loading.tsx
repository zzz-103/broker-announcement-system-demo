export function SessionLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F7FB]" role="status" aria-live="polite">
      <div className="rounded-lg border border-[#D9E2EC] bg-white px-5 py-4 text-sm text-[#667085]">
        正在恢复登录状态…
      </div>
    </div>
  );
}
