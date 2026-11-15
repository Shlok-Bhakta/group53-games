import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";

export function PickSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} bodyClassName="-mt-2 pt-1">
      {children}
    </Sheet>
  );
}
