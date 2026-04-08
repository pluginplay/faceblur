import { useEffect } from "react";
import type { UIMask } from "../types";

interface MoveKeyframesDialogProps {
  open: boolean;
  panelBgColor: string;
  sourceMask: UIMask | null;
  destinationMasks: UIMask[];
  selectedTargetMaskId: string | null;
  selectedKeyframeCount: number;
  onSelectedTargetMaskIdChange: (maskId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MoveKeyframesDialog({
  open,
  panelBgColor,
  sourceMask,
  destinationMasks,
  selectedTargetMaskId,
  selectedKeyframeCount,
  onSelectedTargetMaskIdChange,
  onConfirm,
  onCancel,
}: MoveKeyframesDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open || !sourceMask) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="absolute inset-0" onClick={onCancel} aria-hidden="true" />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-keyframes-title"
        className="relative z-10 flex w-full max-w-[440px] flex-col overflow-hidden rounded-xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-sm"
        style={{ backgroundColor: panelBgColor }}
      >
        <header className="border-b border-white/10 bg-black/10 px-5 py-4">
          <h2 id="move-keyframes-title" className="text-[16px] font-semibold text-[#dce2ec]">
            Move Selected Keyframes
          </h2>
          <p className="mt-1 text-[13px] text-[#aab3bf]">
            Move {selectedKeyframeCount} selected keyframe
            {selectedKeyframeCount === 1 ? "" : "s"} from{" "}
            <span className="font-medium text-[#e7ecf3]">{sourceMask.name}</span>{" "}
            to another track. Matching destination frames will be overwritten.
          </p>
        </header>

        <div className="px-5 py-4">
          <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#8f99a7]">
              Source Track
            </div>
            <div className="mt-1 text-[14px] font-medium text-[#e7ecf3]">
              {sourceMask.name}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[#8f99a7]">
              Destination Track
            </div>
            <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1 s-scroll">
              {destinationMasks.map((mask) => {
                const isSelected = mask.id === selectedTargetMaskId;
                return (
                  <button
                    key={mask.id}
                    type="button"
                    onClick={() => onSelectedTargetMaskIdChange(mask.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "border-[#5c94d3]/55 bg-[#2a3d52] text-[#dbedff]"
                        : "border-white/10 bg-black/15 text-[#c6ccd4] hover:bg-white/5"
                    }`}
                  >
                    <span className="text-[14px] font-medium">{mask.name}</span>
                    <span className="text-[12px] text-[#97a2b1]">
                      {(mask.keyframes && Object.keys(mask.keyframes).length) || 0} kf
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/10 bg-black/10 px-5 py-4">
          <button className="s-button-neutral h-9 px-3.5" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="s-button-primary h-9 px-3.5"
            onClick={onConfirm}
            disabled={!selectedTargetMaskId}
          >
            Confirm Move
          </button>
        </footer>
      </section>
    </div>
  );
}
