export interface AudioInputOption {
  deviceId: string;
  label: string;
}

export const DEFAULT_AUDIO_INPUT = "__browser_default_audio_input__";

export class LiveRequestGate {
  private request = 0;
  private pending = false;

  begin(): number | undefined {
    if (this.pending) return undefined;
    this.pending = true;
    return ++this.request;
  }

  settle(request: number): boolean {
    if (!this.pending || request !== this.request) return false;
    this.pending = false;
    return true;
  }

  cancel(): void {
    this.request++;
    this.pending = false;
  }
}

export function audioInputOptions(devices: Iterable<Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">>): AudioInputOption[] {
  let fallbackNumber = 0;
  return Array.from(devices)
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({
      deviceId: device.deviceId || DEFAULT_AUDIO_INPUT,
      label: device.label.trim() || `Audio input ${++fallbackNumber}`,
    }));
}

export function liveInputErrorMessage(failure: unknown): string {
  if (!(failure instanceof Error)) return "Live input could not start. Check your interface and try again.";
  switch (failure.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was denied. Allow access for this site, then try again.";
    case "NotFoundError":
      return "No audio input was found. Connect your interface, refresh the list and try again.";
    case "OverconstrainedError":
      return "That input is no longer available. Refresh the device list and choose another input.";
    case "NotReadableError":
      return "The input is busy or unavailable. Close other audio apps, reconnect it and try again.";
    default:
      return failure.message || "Live input could not start. Check your interface and try again.";
  }
}
