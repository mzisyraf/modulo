import type { RigGeneration } from "./rigGeneration.ts";

/** Only an explicit generation request can authorize one local refinement. */
export class AutomaticRigRefinement {
  private pending?: { sourceKey: string; requestId: string };

  request(sourceKey: string, requestId: string): void {
    this.pending = { sourceKey, requestId };
  }

  cancel(): void { this.pending = undefined; }

  consume(sourceKey: string, generation: RigGeneration, duration: number): "refine" | "short" | undefined {
    if (!this.pending || this.pending.sourceKey !== sourceKey || this.pending.requestId !== generation.request_id) return;
    if (generation.status === "generating") return;
    this.cancel();
    if (generation.status === "ready") return duration >= 6 ? "refine" : "short";
  }
}
