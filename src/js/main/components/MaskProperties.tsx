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

  const sliderRows = [
    {
      key: "blur",
      label: "Blurriness",
      min: 0,
      max: 300,
      value: blurriness,
      onChange: onBlurrinessChange,
    },
    {
      key: "feather",
      label: "Feather",
      min: 0,
      max: 300,
      value: feather,
      onChange: onFeatherChange,
    },
    {
      key: "expansion",
      label: "Expansion",
      min: -300,
      max: 300,
      value: expansion,
      onChange: onExpansionChange,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="s-panel-title">Mask Properties</h2>
        <span className="px-1.5 py-0.5 s-text-caption font-normal text-[#a4acb8]">
          {activeMask.name}
        </span>
      </div>
      <div className="space-y-2">
        {sliderRows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[88px_minmax(0,1fr)_40px] items-center gap-3"
          >
            <label className="text-[13px] leading-tight font-medium text-[#ccd3dc]">
              {row.label}
            </label>
            <input
              type="range"
              min={row.min}
              max={row.max}
              step={1}
              value={row.value}
              onChange={(e) => row.onChange(Number(e.target.value))}
              className="s-slider"
            />
            <span className="text-right s-text-mono text-[#a3acb8]">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
