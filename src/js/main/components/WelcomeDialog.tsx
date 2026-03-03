import { useEffect } from "react";

interface WelcomeDialogProps {
  open: boolean;
  panelBgColor: string;
  onDismiss: () => void;
  onContinueToDocumentation: () => void;
}

export function WelcomeDialog({
  open,
  panelBgColor,
  onDismiss,
  onContinueToDocumentation,
}: WelcomeDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="absolute inset-0" onClick={onDismiss} aria-hidden="true" />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="face-blur-welcome-title"
        className="relative z-10 flex w-full max-w-[650px] max-h-[86vh] flex-col overflow-hidden rounded-2xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-sm"
        style={{ backgroundColor: panelBgColor }}
      >
        <div className="relative border-b border-white/10 bg-black/10 px-6 py-5">
          <button
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[#c5ccd6] transition-colors hover:bg-white/5"
            onClick={onDismiss}
            aria-label="Close welcome dialog"
            title="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <h2
            id="face-blur-welcome-title"
            className="s-text-title"
          >
            Welcome to Face Blur
          </h2>
          <p className="mt-2 max-w-[560px] s-text-body text-[#c5ccd6]">
            Face Blur detects faces in selected timeline clips, creates tracked
            masks, and helps you apply polished blur overlays in just a few
            clicks.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="max-h-[35vh] space-y-2.5 overflow-y-auto pr-1 s-scroll s-text-body">
            <div className="flex gap-3 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 text-[12px] leading-none font-medium text-[#d8dee6]">
                1
              </span>
              <p>
                Select one or more timeline clips, run detection, and review
                the generated tracks in the preview panel.
              </p>
            </div>
            <div className="flex gap-3 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 text-[12px] leading-none font-medium text-[#d8dee6]">
                2
              </span>
              <p>
                Refine mask points and blur settings, then apply masks to place
                the result on your timeline.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-[#d7dce4]">
              Need a refresher later? Click the help icon in the top bar any
              time to reopen the how-to guide.
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/10 bg-black/10 px-6 py-4">
          <button
            className="s-button-primary h-9 px-3.5"
            onClick={onContinueToDocumentation}
          >
            Continue to Documentation
          </button>
        </footer>
      </section>
    </div>
  );
}
