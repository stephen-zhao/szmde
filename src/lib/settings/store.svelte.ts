import { SettingsService } from "./service";
import { TauriSettingsBackend } from "./tauri-backend";
import { applyAppearance } from "./appearance";
import { DEFAULTS, type DeepPartial, type Settings } from "./schema";

/**
 * Thin Svelte-5 runes adapter over the framework-agnostic SettingsService (which
 * holds all the tested logic). This file is the ONLY settings module that uses
 * runes, so it lives in `.svelte.ts` and is excluded from the unit-coverage gate
 * (vitest has no Svelte compiler; same boundary as the `.svelte` components).
 * Behavior is exercised by the app + E2E; the pure core/service it delegates to
 * are 100% unit-covered.
 */
const service = new SettingsService(new TauriSettingsBackend(), (e) =>
  console.error("[settings]", e),
);

let current = $state<Settings>(DEFAULTS);

/** Reactive effective settings for the shell: read `settings.value.<group>.<key>`. */
export const settings = {
  get value(): Settings {
    return current;
  },
};

function apply(s: Settings): void {
  current = s;
  applyAppearance(document.documentElement, s.appearance);
}

/** Load persisted settings, apply appearance, and keep `settings.value` live. */
export async function initSettings(): Promise<Settings> {
  service.subscribe(apply); // later update()s refresh the rune + CSS vars
  apply(await service.load());
  return current;
}

/** Persist a single dotted-path change (status-bar chips). */
export function setSetting(path: string, value: unknown): void {
  service.set(path, value);
}

/** Persist a deep-partial patch. */
export function updateSettings(patch: DeepPartial<Settings>): void {
  service.update(patch);
}

/** Await any in-flight persist (clean shutdown). */
export function flushSettings(): Promise<void> {
  return service.flush();
}
