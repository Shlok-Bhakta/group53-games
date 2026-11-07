import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";

// A sheet of choices, its list sitting closer under the title than the kit's (pb-2 under the header, pt-1 on
// top of the list).
export function PickSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} bodyClassName="-mt-2 pt-1">
      {children}
    </Sheet>
  );
}
