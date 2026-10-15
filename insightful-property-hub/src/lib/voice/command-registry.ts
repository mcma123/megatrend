import { useEffect, useRef } from "react";
import { catalogCommand } from "./commands";
import type { VoiceCommand, VoiceField, VoiceFieldValue, VoicePageKey } from "./types";

// Live page commands for the voice assistant. Pages register handlers for catalog commands while
// mounted; only commands whose button would be usable should be enabled.

export type VoiceCommandHandler = {
  /** Runs the command. Return a short result message, or throw to report an error. */
  run: (args: Record<string, VoiceFieldValue>) => void | string | Promise<void | string>;
  /** Live parameter definitions (e.g. select options known only on this page). */
  params?: VoiceField[];
  enabled?: boolean;
};

type Registration = { page: VoicePageKey; get: () => Record<string, VoiceCommandHandler> };

const registrations = new Set<Registration>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function findHandler(commandId: string) {
  for (const registration of [...registrations].reverse()) {
    const handler = registration.get()[commandId];
    if (handler && handler.enabled !== false) return handler;
  }
  return null;
}

/** Commands usable right now, with live parameters. */
export function getPageCommands(): VoiceCommand[] {
  const commands = new Map<string, VoiceCommand>();
  for (const registration of registrations) {
    for (const [id, handler] of Object.entries(registration.get())) {
      const definition = catalogCommand(id);
      if (!definition || handler.enabled === false) continue;
      commands.set(id, { ...definition, params: handler.params ?? definition.params });
    }
  }
  return [...commands.values()];
}

/** Resolve once `commandId` has an enabled handler (e.g. after navigation), or null on timeout. */
export function waitForCommand(
  commandId: string,
  timeoutMs = 5000,
): Promise<VoiceCommandHandler | null> {
  const existing = findHandler(commandId);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      listeners.delete(check);
      resolve(findHandler(commandId));
    }, timeoutMs);
    function check() {
      const handler = findHandler(commandId);
      if (!handler) return;
      window.clearTimeout(timer);
      listeners.delete(check);
      resolve(handler);
    }
    listeners.add(check);
  });
}

/**
 * Register a page's voice command handlers while it is mounted.
 *
 *   useVoiceCommands("leases.detail", {
 *     "lease.startRenewal": { run: startRenewal, enabled: lease.canEdit && lease.status === "active" },
 *   });
 */
export function useVoiceCommands(
  page: VoicePageKey,
  handlers: Record<string, VoiceCommandHandler>,
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const enabledKey = Object.entries(handlers)
    .filter(([, handler]) => handler.enabled !== false)
    .map(([id]) => id)
    .join(",");

  useEffect(() => {
    const registration: Registration = { page, get: () => latest.current };
    registrations.add(registration);
    notify();
    return () => {
      registrations.delete(registration);
      notify();
    };
  }, [page, enabledKey]);
}
