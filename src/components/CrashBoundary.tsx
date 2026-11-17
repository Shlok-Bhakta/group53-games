import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { reloadFresh } from "@/version";

type Props = { title: string; onCrash?: (error: Error) => void; className?: string; children: ReactNode };

export class CrashBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
    this.props.onCrash?.(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section
        role="alert"
        className={cn("flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center", this.props.className)}
      >
        <h2 className="font-display text-title">{this.props.title}</h2>
        <p className="max-w-[30ch] font-mono text-footnote text-muted-foreground">{this.state.error.message}</p>
        <Button size="xl" onClick={() => void reloadFresh()}>
          Reload
        </Button>
      </section>
    );
  }
}
