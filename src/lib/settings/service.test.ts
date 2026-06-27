import { describe, expect, it, vi } from "vitest";
import { SettingsService } from "./service";
import { InMemorySettingsBackend } from "./backend";
import { DEFAULTS, SCHEMA_VERSION } from "./schema";

const json = (o: unknown) => JSON.stringify(o);

describe("[REQ-SET-1] SettingsService — load + layering", () => {
  it("yields DEFAULTS when no files are present (first run)", async () => {
    const svc = new SettingsService(new InMemorySettingsBackend());
    expect(await svc.load()).toEqual(DEFAULTS);
  });

  it("applies user overrides over DEFAULTS", async () => {
    const svc = new SettingsService(
      new InMemorySettingsBackend({ user: json({ editor: { renderMode: "markers-syntax" } }) }),
    );
    const eff = await svc.load();
    expect(eff.editor.renderMode).toBe("markers-syntax");
    expect(eff.editor.indentWidth).toBe(2); // untouched → default
  });

  it("layers DEFAULTS < system < user", async () => {
    const svc = new SettingsService(
      new InMemorySettingsBackend({
        system: json({ appearance: { accentColor: "#111111" }, editor: { indentWidth: 8 } }),
        user: json({ editor: { indentWidth: 4 } }),
      }),
    );
    const eff = await svc.load();
    expect(eff.appearance.accentColor).toBe("#111111"); // from system
    expect(eff.editor.indentWidth).toBe(4); // user beats system
  });

  it("degrades to DEFAULTS on corrupt user JSON and reports the error", async () => {
    const onError = vi.fn();
    const svc = new SettingsService(new InMemorySettingsBackend({ user: "{not valid json" }), onError);
    expect(await svc.load()).toEqual(DEFAULTS);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("swallows errors with the default no-op handler when none is provided", async () => {
    const svc = new SettingsService(new InMemorySettingsBackend({ user: "{bad json" }));
    await expect(svc.load()).resolves.toEqual(DEFAULTS); // no throw, no onError supplied
  });

  it("degrades and reports when a read rejects (real I/O error)", async () => {
    const onError = vi.fn();
    const backend = new InMemorySettingsBackend();
    backend.failReadUser = true;
    const svc = new SettingsService(backend, onError);
    expect(await svc.load()).toEqual(DEFAULTS);
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("[REQ-SET-1] SettingsService — get / getValue / immutability", () => {
  it("get() returns a deeply frozen snapshot", async () => {
    const svc = new SettingsService(new InMemorySettingsBackend());
    const eff = await svc.load();
    expect(Object.isFrozen(eff)).toBe(true);
    expect(Object.isFrozen(eff.appearance)).toBe(true);
  });

  it("getValue reads dotted paths and returns undefined for missing ones", async () => {
    const svc = new SettingsService(new InMemorySettingsBackend());
    await svc.load();
    expect(svc.getValue("editor.indentWidth")).toBe(2);
    expect(svc.getValue("nope.x.y")).toBeUndefined();
  });
});

describe("[REQ-SET-1] SettingsService — update / set / persist", () => {
  it("update persists only the minimal user diff (version-stamped)", async () => {
    const backend = new InMemorySettingsBackend();
    const svc = new SettingsService(backend);
    await svc.load();
    svc.update({ editor: { renderMode: "markers-rendered" } });
    await svc.flush();
    expect(JSON.parse(backend.lastWritten!)).toEqual({
      version: SCHEMA_VERSION,
      editor: { renderMode: "markers-rendered" },
    });
    expect(svc.get().editor.renderMode).toBe("markers-rendered");
  });

  it("set() writes a dotted path through update()", async () => {
    const backend = new InMemorySettingsBackend();
    const svc = new SettingsService(backend);
    await svc.load();
    svc.set("appearance.theme", "light");
    await svc.flush();
    expect(svc.get().appearance.theme).toBe("light");
    expect(JSON.parse(backend.lastWritten!).appearance.theme).toBe("light");
  });

  it("notifies subscribers on a real change and stops after unsubscribe", async () => {
    const svc = new SettingsService(new InMemorySettingsBackend());
    await svc.load();
    const seen: string[] = [];
    const off = svc.subscribe((s) => seen.push(s.editor.renderMode));
    svc.update({ editor: { renderMode: "markers-syntax" } });
    off();
    svc.update({ editor: { renderMode: "clean" } });
    expect(seen).toEqual(["markers-syntax"]);
  });

  it("no-op guard: an update that doesn't change effective skips persist + notify", async () => {
    const backend = new InMemorySettingsBackend();
    const svc = new SettingsService(backend);
    await svc.load();
    const sub = vi.fn();
    svc.subscribe(sub);
    svc.update({ editor: { renderMode: DEFAULTS.editor.renderMode } }); // same as current
    await svc.flush();
    expect(backend.writeCount).toBe(0);
    expect(sub).not.toHaveBeenCalled();
  });

  it("reports but survives a persist failure (effective still updates)", async () => {
    const onError = vi.fn();
    const backend = new InMemorySettingsBackend();
    backend.failWriteUser = true;
    const svc = new SettingsService(backend, onError);
    await svc.load();
    svc.update({ editor: { renderMode: "markers-syntax" } });
    await svc.flush();
    expect(svc.get().editor.renderMode).toBe("markers-syntax"); // UI stays responsive
    expect(onError).toHaveBeenCalledOnce();
  });
});
