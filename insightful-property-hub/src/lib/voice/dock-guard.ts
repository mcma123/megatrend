/**
 * Wrap a Radix `onInteractOutside` handler so presses on the floating voice dock
 * (`[data-voice-dock]`) do not close the open dialog or sheet.
 */
export function keepOpenForVoiceDock<
  E extends { target: EventTarget | null; preventDefault(): void },
>(handler?: (event: E) => void) {
  return (event: E) => {
    if (event.target instanceof Element && event.target.closest("[data-voice-dock]")) {
      event.preventDefault();
    }
    handler?.(event);
  };
}
