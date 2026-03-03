import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      richColors={false}
      closeButton
      position="bottom-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[#1f2023] group-[.toaster]:text-[#e8e8e8] group-[.toaster]:border-white/15 group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-[#b7bec7]",
          success:
            "group-[.toaster]:bg-[#1a2420] group-[.toaster]:text-[#d8e7df] group-[.toaster]:border-[#2f4a3e]",
          actionButton:
            "group-[.toast]:bg-[#375d8b] group-[.toast]:text-white group-[.toast]:hover:bg-[#4270a7]",
          cancelButton:
            "group-[.toast]:bg-[#34373c] group-[.toast]:text-[#d9dde2] group-[.toast]:hover:bg-[#40454d]",
        },
      }}
      {...props}
    />
  );
}
