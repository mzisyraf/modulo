export type AutomaticRefinementDecision = "refine" | "short" | "manual";

/** A ready status is eligible only when it belongs to an explicit local Generate. */
export class AutomaticRigRefinement {
  private serial = 0;
  private pending?: { ticket: number; context: string; enabled: boolean; requestId?: string };

  begin(context: string, enabled: boolean): number {
    const ticket = ++this.serial;
    this.pending = { ticket, context, enabled };
    return ticket;
  }

  acknowledge(ticket: number, context: string, requestId: string): boolean {
    if (!this.pending || this.pending.ticket !== ticket || this.pending.context !== context) return false;
    this.pending.requestId = requestId;
    return true;
  }

  consume(context: string, requestId: string, status: "generating" | "ready" | "failed", duration: number): AutomaticRefinementDecision | undefined {
    const pending = this.pending;
    if (!pending || pending.context !== context || pending.requestId !== requestId || status === "generating") return;
    this.pending = undefined; // Consume before starting async rendering, including short/off/failure cases.
    if (status === "failed") return;
    if (!pending.enabled) return "manual";
    return Number.isFinite(duration) && duration >= 6 && duration <= 90 ? "refine" : "short";
  }

  cancel(): void { this.pending = undefined; this.serial++; }
}
