import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveScheduler } from "./autosave";

describe("[REQ-SAVE-2] AutosaveScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves once after the interval of quiet following an edit", () => {
    const save = vi.fn();
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: true });
    s.notifyDirty();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(99);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of edits into a single save", () => {
    const save = vi.fn();
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: true });
    s.notifyDirty();
    vi.advanceTimersByTime(50);
    s.notifyDirty(); // resets the debounce
    vi.advanceTimersByTime(50);
    s.notifyDirty();
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not save when disabled", () => {
    const save = vi.fn();
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: false });
    s.notifyDirty();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("disabling cancels a pending save", () => {
    const save = vi.fn();
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: true });
    s.notifyDirty();
    s.setEnabled(false);
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("re-enabling allows saves again", () => {
    const save = vi.fn();
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: false });
    s.setEnabled(true);
    s.notifyDirty();
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("honors a changed interval", () => {
    const save = vi.fn();
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: true });
    s.setIntervalMs(500);
    s.notifyDirty();
    vi.advanceTimersByTime(100);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush() saves immediately and cancels the pending debounce", async () => {
    const save = vi.fn();
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: true });
    s.notifyDirty();
    await s.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); // the pending timer was cancelled
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a failed save does not wedge later saves", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: true });
    await s.flush(); // first: rejects, swallowed
    await s.flush(); // second: succeeds
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not overlap saves (a second flush while one is in flight is a no-op)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const save = vi.fn(() => gate);
    const s = new AutosaveScheduler({ save, intervalMs: 100, enabled: true });
    const f1 = s.flush();
    const f2 = s.flush(); // in-flight → skipped
    release();
    await Promise.all([f1, f2]);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
