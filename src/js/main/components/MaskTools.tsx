interface MaskToolsProps {
  onApplyMasks: () => void;
  canApply: boolean;
}

export function MaskTools({
  onApplyMasks,
  canApply,
}: MaskToolsProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={onApplyMasks}
        disabled={!canApply}
        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
      >
        Apply Masks
      </button>
    </div>
  );
}
