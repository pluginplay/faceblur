import type { UIMask } from "../types";

interface MaskListProps {
  masks: UIMask[];
  activeMaskId: string | null;
  onSelectMask: (id: string) => void;
  onRemove: (id: string) => void;
}

export function MaskList({
  masks,
  activeMaskId,
  onSelectMask,
  onRemove,
}: MaskListProps) {
  return (
    <div className="flex flex-col gap-1 min-h-0 overflow-y-auto">
      <div className="flex gap-2 items-center px-2 py-1.5 border-b border-gray-700/80 shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Tracks
        </span>
        <span className="text-xs text-gray-500">
          {masks.length}
        </span>
      </div>
      {masks.length === 0 ? (
        <div className="px-2 py-4 text-center text-gray-500 text-xs">
          No tracks yet
        </div>
      ) : (
      <div className="flex flex-col gap-1 min-h-0 overflow-y-auto">
        {masks.map((m, idx) => (
          <div
            key={m.id}
            className={`flex items-center gap-1.5 px-2 py-2 rounded-md transition-colors relative shrink-0 group ${
              m.id === activeMaskId
                ? "bg-teal-600/90 text-white shadow-sm"
                : "bg-gray-700/60 text-gray-200 hover:bg-gray-600/80"
            }`}
          >
            <button
              onClick={() => onSelectMask(m.id)}
              className="flex-1 min-w-0 text-left text-sm font-medium truncate"
            >
              {m.name || `Mask ${idx + 1}`}
            </button>
            <span className="text-xs opacity-70 shrink-0">
              {m.points.length} pts
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(m.id);
              }}
              className="p-1 hover:bg-red-600/80 rounded opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold"
              title="Delete mask"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
