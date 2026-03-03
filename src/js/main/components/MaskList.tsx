import type { UIMask } from "../types";
import { Check, ChevronLeft, ChevronRight, RotateCcw, RotateCw, Trash2 } from "lucide-react";

interface MaskListProps {
  masks: UIMask[];
  activeMaskId: string | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectMask: (id: string) => void;
  onRemove: (id: string) => void;
  canApply: boolean;
  onApplyMasks: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function MaskList({
  masks,
  activeMaskId,
  isCollapsed,
  onToggleCollapse,
  onSelectMask,
  onRemove,
  canApply,
  onApplyMasks,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: MaskListProps) {
  const getCollapsedLabel = (name: string) => {
    const normalized = name.trim();
    const personMatch = normalized.match(/^Person\s*(\d+)$/i);
    if (personMatch) return `P${personMatch[1]}`;
    return normalized || "Mask";
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`shrink-0 border-b border-white/10 ${
          isCollapsed ? "px-2 py-2" : "px-3 py-2.5"
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          {!isCollapsed && <span className="s-panel-title">Tracks</span>}
          <button
            onClick={onToggleCollapse}
            className={`s-button-ghost h-6 w-6 shrink-0 px-0 ${
              isCollapsed ? "mx-auto" : ""
            }`}
            title={isCollapsed ? "Expand tracks" : "Collapse tracks"}
            aria-label={isCollapsed ? "Expand tracks" : "Collapse tracks"}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>

      {isCollapsed ? (
        <div className="flex h-full min-h-0 flex-1 flex-col p-2">
          <div className="s-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {masks.length === 0 ? (
              <div className="rounded-md border border-white/10 px-2 py-3 text-center s-text-caption font-normal text-[#8f99a7]">
                No tracks
              </div>
            ) : (
              masks.map((m, idx) => (
                <div
                  key={m.id}
                  className={`group relative rounded-md border transition-colors ${
                    m.id === activeMaskId
                      ? "border-[#5a90cc]/60 bg-[#2d3e52] text-[#d8eafe]"
                      : "border-white/10 bg-white/[0.02] text-[#c6ccd4] hover:bg-white/[0.06]"
                  }`}
                  title={m.name || `Mask ${idx + 1}`}
                >
                  <button
                    onClick={() => onSelectMask(m.id)}
                    className="w-full px-1 py-1.5 text-center"
                  >
                    <div className="text-[12px] font-semibold leading-tight tracking-tight">
                      {getCollapsedLabel(m.name || `Mask ${idx + 1}`)}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-none text-[#97a2b1]">
                      {m.points.length} pts
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(m.id);
                    }}
                    className="absolute right-0 top-0 z-10 inline-flex h-4 w-4 items-center justify-center rounded-tr-md rounded-bl-md text-[#c6ccd4] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/80 hover:text-white"
                    title="Delete mask"
                    aria-label={`Delete ${m.name || `Mask ${idx + 1}`}`}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 grid grid-cols-1 gap-1.5">
            <button
              onClick={onApplyMasks}
              disabled={!canApply}
              className="s-button-cta h-7 w-full px-0"
              title="Apply masks"
              aria-label="Apply masks"
            >
              <Check size={14} />
            </button>
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="s-button-neutral h-7 w-full px-0"
              title="Undo"
              aria-label="Undo"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="s-button-neutral h-7 w-full px-0"
              title="Redo"
              aria-label="Redo"
            >
              <RotateCw size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="s-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {masks.length === 0 ? (
              <div className="px-2 py-4 text-center s-text-caption font-normal text-[#8f99a7]">
                Run detection to populate tracks.
              </div>
            ) : (
              masks.map((m, idx) => (
                <div
                  key={m.id}
                  className={`relative shrink-0 group flex items-center gap-1.5 px-2.5 py-2 rounded-md border transition-colors ${
                    m.id === activeMaskId
                      ? "bg-[#2a3d52] border-[#5c94d3]/40 text-[#dbedff]"
                      : "border-transparent text-[#c6ccd4] hover:bg-white/5"
                  }`}
                >
                  <button
                    onClick={() => onSelectMask(m.id)}
                    className="flex-1 min-w-0 text-left text-[14px] leading-tight font-medium truncate"
                  >
                    {m.name || `Mask ${idx + 1}`}
                  </button>
                  <span className="text-[12px] leading-none opacity-75 shrink-0">
                    {m.points.length} pts
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(m.id);
                    }}
                    className="inline-flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/80"
                    title="Delete mask"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="shrink-0 border-t border-white/10 p-2.5">
            <button
              onClick={onApplyMasks}
              disabled={!canApply}
              className="s-button-cta w-full"
            >
              Apply Masks
            </button>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="s-button-neutral w-full"
            >
              <RotateCcw size={14} />
              Undo
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="s-button-neutral w-full"
            >
              <RotateCw size={14} />
              Redo
            </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
