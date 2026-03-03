import { useEffect } from "react";

interface HelpGuideDialogProps {
  open: boolean;
  panelBgColor: string;
  onOpenChange: (open: boolean) => void;
}

export function HelpGuideDialog({
  open,
  panelBgColor,
  onOpenChange,
}: HelpGuideDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4">
      <div
        className="absolute inset-0"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="face-blur-help-title"
        className="relative z-10 flex w-full max-w-[650px] max-h-[86vh] flex-col overflow-hidden rounded-2xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-sm"
        style={{ backgroundColor: panelBgColor }}
      >
        <header className="relative border-b border-white/10 bg-black/10 px-6 py-5">
          <button
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[#c5ccd6] transition-colors hover:bg-white/5"
            onClick={() => onOpenChange(false)}
            aria-label="Close help dialog"
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
          <div>
            <h2
              id="face-blur-help-title"
              className="s-text-title"
            >
              Face Blur Documentation
            </h2>
            <p className="mt-1 s-text-body text-[#c5ccd6]">
              End-to-end workflow for generating and applying face blur masks.
            </p>
          </div>
        </header>

        <div className="px-6 py-5">
          <ol className="max-h-[52vh] space-y-2.5 overflow-y-auto pr-1 s-scroll s-text-body">
            <li className="flex gap-3 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 text-[12px] leading-none font-medium text-[#d8dee6]">
                1
              </span>
              <p>
                Select one or more timeline clips, then click{" "}
                <span className="font-medium text-[#e7ebf1]">
                  Run Selected Clips
                </span>
                . The tool renders each segment and generates tracked faces.
              </p>
            </li>

            <li className="flex gap-3 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 text-[12px] leading-none font-medium text-[#d8dee6]">
                2
              </span>
              <p>
                Segment data is stored in owned sequence markers. Move the
                playhead inside a marker range to auto-load that segment.
              </p>
            </li>

            <li className="flex gap-3 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 text-[12px] leading-none font-medium text-[#d8dee6]">
                3
              </span>
              <p>
                Refine masks in the panel by adjusting points, blur, feather,
                and expansion settings.
              </p>
            </li>

            <li className="flex gap-3 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 text-[12px] leading-none font-medium text-[#d8dee6]">
                4
              </span>
              <p>
                Click{" "}
                <span className="font-medium text-[#e7ebf1]">Apply Masks</span>{" "}
                to import the generated blur result onto the timeline.
              </p>
            </li>

            <li className="rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-[#d7dce4]">
              Required Premiere step: right-click the newly added layer and set
              it to <span className="font-medium text-[#eef1f5]">Adjustment Layer</span>{" "}
              so transparency and masking apply correctly.
            </li>

            <li className="flex gap-3 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 text-[12px] leading-none font-medium text-[#d8dee6]">
                5
              </span>
              <p>
                To work on another analyzed segment, move the playhead to a
                different marker range.
              </p>
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
