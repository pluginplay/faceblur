import type { UIMask } from "../types";

interface MaskPropertiesProps {
  activeMask: UIMask | null;
  onBlurrinessChange: (v: number) => void;
  onFeatherChange: (v: number) => void;
  onExpansionChange: (v: number) => void;
}

export function MaskProperties({
  activeMask,
  onBlurrinessChange,
  onFeatherChange,
  onExpansionChange,
}: MaskPropertiesProps) {
  if (!activeMask) return null;

  const blurriness = activeMask.blurriness ?? 50;
  const feather = activeMask.feather ?? 10;
  const expansion = activeMask.expansion ?? 0;

  return (
    <div className="flex gap-4 items-center flex-wrap p-2 rounded-lg bg-gray-800/40 border border-gray-700/50">
      <div className="flex items-center gap-2">
        <label className="text-gray-300 text-xs font-medium min-w-[70px]">
          Blurriness
        </label>
        <input
          type="range"
          min={0}
          max={300}
          step={1}
          value={blurriness}
          onChange={(e) => onBlurrinessChange(Number(e.target.value))}
          className="w-32 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-600"
        />
        <span className="text-gray-400 text-xs w-8 text-right">
          {blurriness}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-gray-300 text-xs font-medium min-w-[70px]">
          Feather
        </label>
        <input
          type="range"
          min={0}
          max={300}
          step={1}
          value={feather}
          onChange={(e) => onFeatherChange(Number(e.target.value))}
          className="w-32 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-600"
        />
        <span className="text-gray-400 text-xs w-8 text-right">{feather}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-gray-300 text-xs font-medium min-w-[70px]">
          Expansion
        </label>
        <input
          type="range"
          min={-300}
          max={300}
          step={1}
          value={expansion}
          onChange={(e) => onExpansionChange(Number(e.target.value))}
          className="w-32 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-600"
        />
        <span className="text-gray-400 text-xs w-8 text-right">
          {expansion}
        </span>
      </div>
    </div>
  );
}
