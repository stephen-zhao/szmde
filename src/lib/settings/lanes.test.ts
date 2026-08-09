import { afterEach, describe, expect, it } from "vitest";
import { applyLanes, LANE_IDS, LANE_REGISTRY } from "./lanes";
import { DEFAULTS, type LanesSettings } from "./schema";

// happy-dom gives us a real element whose inline CSS custom properties we can read
// back. applyLanes is a pure DOM write, so this fully exercises it (REQ-LANE-1).
let el: HTMLElement | undefined;
afterEach(() => {
  el?.remove();
  el = undefined;
});
function target(): HTMLElement {
  el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("[REQ-LANE-1] LANE_REGISTRY — code-side lane definitions", () => {
  it("keeps the shipped fold/marker widths (settings === today's visuals)", () => {
    // These were the hardcoded .cm-content values before REQ-LANE-1; theme.ts now
    // reads them from here, so any change must be deliberate + mirrored in both.
    expect(LANE_REGISTRY.fold.width).toBe("calc(var(--editor-font-size) * 1.7)");
    expect(LANE_REGISTRY.marker.width).toBe("calc(var(--editor-font-size) * 3.2)");
    expect(LANE_REGISTRY.fold.cssVar).toBe("--fold-col");
    expect(LANE_REGISTRY.marker.cssVar).toBe("--marker-gutter");
  });

  it("marks the marker lane mandatory and fold optional (SPEC §7.6 carve-out)", () => {
    expect(LANE_REGISTRY.marker.mandatory).toBe(true);
    expect(LANE_REGISTRY.fold.mandatory).toBe(false);
  });

  it("lists both lanes fold-before-marker (canonical left-to-right order)", () => {
    expect(LANE_IDS).toEqual(["fold", "marker"]);
  });
});

describe("[REQ-LANE-1] applyLanes — lane model → CSS variables", () => {
  it("reserves both lanes' widths for the DEFAULTS (both reserved)", () => {
    const t = target();
    applyLanes(t, DEFAULTS.lanes);
    expect(t.style.getPropertyValue("--fold-col")).toBe(LANE_REGISTRY.fold.width);
    expect(t.style.getPropertyValue("--marker-gutter")).toBe(LANE_REGISTRY.marker.width);
    // The fold-chevron affordance is visible in the default (reserved) layout.
    expect(t.style.getPropertyValue("--fold-chevron-display")).toBe("inline-flex");
  });

  it("reserves width for a `drawer` lane too (drawers don't collapse until the drawer slice)", () => {
    const t = target();
    const lanes: LanesSettings = {
      order: ["fold", "marker"],
      byId: {
        fold: { strategy: "drawer", drawerHeight: 1 },
        marker: { strategy: "drawer", drawerHeight: 2 },
      },
    };
    applyLanes(t, lanes);
    expect(t.style.getPropertyValue("--fold-col")).toBe(LANE_REGISTRY.fold.width);
    expect(t.style.getPropertyValue("--marker-gutter")).toBe(LANE_REGISTRY.marker.width);
    expect(t.style.getPropertyValue("--fold-chevron-display")).toBe("inline-flex");
  });

  it("collapses an `off` fold lane to zero width and hides its chevron", () => {
    const t = target();
    const lanes: LanesSettings = {
      order: ["fold", "marker"],
      byId: {
        fold: { strategy: "off", drawerHeight: 1 },
        marker: { strategy: "reserved", drawerHeight: 2 },
      },
    };
    applyLanes(t, lanes);
    expect(t.style.getPropertyValue("--fold-col")).toBe("0px");
    expect(t.style.getPropertyValue("--fold-chevron-display")).toBe("none");
    // marker (mandatory) is untouched — still reserved.
    expect(t.style.getPropertyValue("--marker-gutter")).toBe(LANE_REGISTRY.marker.width);
  });

  it("defaults a lane with no settings object to reserving its width", () => {
    const t = target();
    // A byId with no entries — applyLanes falls each lane back to reserved.
    applyLanes(t, { order: [], byId: {} as LanesSettings["byId"] });
    expect(t.style.getPropertyValue("--fold-col")).toBe(LANE_REGISTRY.fold.width);
    expect(t.style.getPropertyValue("--marker-gutter")).toBe(LANE_REGISTRY.marker.width);
    expect(t.style.getPropertyValue("--fold-chevron-display")).toBe("inline-flex");
  });
});
