interface StatusBarProps {
  message: string;
}

export function StatusBar({ message }: StatusBarProps) {
  if (!message) return null;

  return (
    <div className="px-3 py-2 bg-gray-800 rounded-md border border-gray-700 overflow-hidden min-w-0">
      <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">{message}</p>
    </div>
  );
}
