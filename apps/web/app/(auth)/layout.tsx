export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-2 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div aria-hidden className="flex size-7 items-center justify-center rounded-control bg-iris-9 text-ui font-semibold text-white">
            F
          </div>
          <span className="text-section font-semibold">Fahd Ads Launcher</span>
        </div>
        <div className="rounded-dialog border border-slate-6 bg-slate-1 p-6">{children}</div>
      </div>
    </main>
  );
}
