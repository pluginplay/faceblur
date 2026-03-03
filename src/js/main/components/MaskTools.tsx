interface MaskToolsProps {
  onApplyMasks: () => void;
  canApply: boolean;
}

export function MaskTools({
  onApplyMasks,
  canApply,
}: MaskToolsProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onApplyMasks}
        disabled={!canApply}
        className="s-button-cta min-w-[120px]"
      >
        Apply Masks
      </button>
    </div>
  );
}
