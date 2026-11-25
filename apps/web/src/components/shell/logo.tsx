export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="sig" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--info)" />
          </linearGradient>
        </defs>
        <path d="M16 3 27 9.5v13L16 29 5 22.5v-13Z" fill="none" stroke="url(#sig)" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M11 13.5 16 11l5 2.5v5L16 21l-5-2.5Z" fill="url(#sig)" opacity="0.9" />
      </svg>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight">
          Samp<span className="text-accent">Intel</span> <span className="text-muted font-normal">AI</span>
        </span>
      )}
    </div>
  );
}
