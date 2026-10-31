/** Public pages Meta asks for (Privacy Policy and data deletion URLs) to switch an app to Live. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-2 px-4 py-12">
      <article className="mx-auto grid max-w-2xl gap-4 rounded-dialog border border-slate-6 bg-slate-1 p-6 text-body leading-6 text-slate-12 md:p-8 [&_h1]:text-title [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-section [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-slate-12">
        <div className="flex items-center gap-2.5">
          <div aria-hidden className="flex size-7 items-center justify-center rounded-control bg-iris-9 text-ui font-semibold text-white">
            F
          </div>
          <span className="text-section font-semibold">Fahd Ads Launcher</span>
        </div>
        {children}
      </article>
    </main>
  );
}
