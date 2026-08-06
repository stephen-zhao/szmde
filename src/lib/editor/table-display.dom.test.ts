import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { setTablePinHeader, setTableWidthMode, tableDisplayAt } from "./table-display";
import { tableBlockAt } from "./table-commands";
import { closeTableMenu } from "./table-menu";

// Rendered-DOM tests for the per-table display modes (REQ-TBLED-10 width, REQ-TBLED-11
// pin) on REAL EditorViews. happy-dom has no layout, so the flicker-free column-sizing
// + header-follow measure passes are v8-ignored and verified live (WF-34/35/36); here we
// assert the DOM STRUCTURE (scroll box, overflow class, colgroup, header padding spans,
// pin classes) and the menu wiring those modes hang off.
let view: EditorView | undefined;
afterEach(() => {
  closeTableMenu();
  view?.destroy();
  view = undefined;
});

function build(doc: string, caret = 0): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: editorExtensions(true, "clean"),
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}

const count = (v: EditorView, sel: string) => v.contentDOM.querySelectorAll(sel).length;

// caret on the intro line so the table (lines 2+) renders rather than reveals.
const DOC = "intro\n\n| a | b |\n| - | :-: |\n| 1 | 2 |\n| 3 | 4 |";
const tbl = (v: EditorView) => tableBlockAt(v.state, DOC.indexOf("| a"))!;

describe("[REQ-TBLED-10][REQ-TBLED-11] table display modes — default (fit, unpinned)", () => {
  it("renders a plain table with no scroll box and no pin/overflow classes", () => {
    const v = build(DOC);
    expect(count(v, ".cm-md-table")).toBe(1);
    expect(count(v, ".cm-md-table-scroll")).toBe(0);
    expect(count(v, ".cm-md-table-overflow")).toBe(0);
    expect(count(v, ".cm-md-table-pin")).toBe(0);
    expect(count(v, ".cm-md-table-pin-js")).toBe(0);
  });
});

describe("[REQ-TBLED-10] width mode — overflow", () => {
  it("wraps the table in an independent scroll box with a per-column <colgroup>", () => {
    const v = build(DOC);
    expect(setTableWidthMode(v, tbl(v).from, "overflow")).toBe(true);
    const scroll = v.contentDOM.querySelector(".cm-md-table-scroll");
    expect(scroll).toBeTruthy();
    const table = scroll!.querySelector("table.cm-md-table.cm-md-table-overflow");
    expect(table).toBeTruthy();
    expect(table!.querySelectorAll("colgroup > col").length).toBe(2); // one <col> per column
    // The width mode is recorded in the (ephemeral) display state, not the doc.
    expect(tableDisplayAt(v.state, tbl(v).from, tbl(v).to).width).toBe("overflow");
    expect(v.state.doc.toString()).toBe(DOC); // source untouched
  });

  it("preserves header padding as preformatted spans so it can widen the column", () => {
    const padded = `intro\n\n| Name${" ".repeat(6)} | b |\n| - | - |\n| 1 | 2 |`;
    const v = build(padded);
    const t = tableBlockAt(v.state, padded.indexOf("| Name"))!;
    setTableWidthMode(v, t.from, "overflow");
    // The padded header cell carries at least one preformatted padding run.
    const firstTh = v.contentDOM.querySelector(".cm-md-table-overflow th");
    expect(firstTh!.querySelectorAll(".cm-tbl-pad").length).toBeGreaterThan(0);
    expect(firstTh!.textContent).toContain("Name");
  });

  it("does not double-count padding for an all-whitespace header cell", () => {
    // A blank header cell serializes to `|  |` → raw "  "; overflow must render those 2
    // pad spaces ONCE (one lead run), not doubled (lead + trail both = raw.length).
    const doc = "intro\n\n|  | b |\n| - | - |\n| 1 | 2 |";
    const v = build(doc);
    const t = tableBlockAt(v.state, doc.indexOf("|  |"))!;
    setTableWidthMode(v, t.from, "overflow");
    const firstTh = v.contentDOM.querySelector(".cm-md-table-overflow th")!;
    const padChars = [...firstTh.querySelectorAll(".cm-tbl-pad")].reduce(
      (n, s) => n + (s.textContent?.length ?? 0),
      0,
    );
    expect(padChars).toBe(2); // the raw "  " padding, not 4
  });

  it("switches back to fit — the scroll box and overflow class are gone", () => {
    const v = build(DOC);
    setTableWidthMode(v, tbl(v).from, "overflow");
    expect(count(v, ".cm-md-table-scroll")).toBe(1);
    setTableWidthMode(v, tbl(v).from, "fit");
    expect(count(v, ".cm-md-table-scroll")).toBe(0);
    expect(count(v, ".cm-md-table-overflow")).toBe(0);
  });

  it("returns false (no dispatch) when the anchor isn't in a table", () => {
    const v = build("just prose, no table here");
    expect(setTableWidthMode(v, 3, "overflow")).toBe(false);
    expect(count(v, ".cm-md-table-scroll")).toBe(0);
  });
});

describe("[REQ-TBLED-12] overflow column-resize grips", () => {
  it("adds a resize grip to each overflow header cell; fit mode has none", () => {
    const v = build(DOC);
    expect(count(v, ".cm-tbl-colresize")).toBe(0); // fit (default) — no grips
    setTableWidthMode(v, tbl(v).from, "overflow");
    expect(count(v, ".cm-md-table-overflow th .cm-tbl-colresize")).toBe(2); // one per column
  });

  it("the grip swallows a compat mousedown so it can't reach the cell editor", () => {
    const v = build(DOC);
    setTableWidthMode(v, tbl(v).from, "overflow");
    const grip = v.contentDOM.querySelector(".cm-tbl-colresize")!;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    grip.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // preventDefault + stopPropagation ran
  });
});

describe("[REQ-TBLED-11] pin header row", () => {
  it("adds the sticky-header class in fit mode", () => {
    const v = build(DOC);
    expect(setTablePinHeader(v, tbl(v).from, true)).toBe(true);
    expect(count(v, ".cm-md-table.cm-md-table-pin")).toBe(1);
    expect(count(v, ".cm-md-table-pin-js")).toBe(0);
    setTablePinHeader(v, tbl(v).from, false);
    expect(count(v, ".cm-md-table-pin")).toBe(0);
  });

  it("uses the JS-follow variant (not CSS sticky) when combined with overflow", () => {
    const v = build(DOC);
    setTableWidthMode(v, tbl(v).from, "overflow");
    setTablePinHeader(v, tbl(v).from, true);
    expect(count(v, ".cm-md-table-pin-js")).toBe(1);
    expect(count(v, ".cm-md-table.cm-md-table-pin")).toBe(0); // NOT the sticky variant
    // A scroll on the editor drives the header-follow plugin (measure is layout-only).
    v.scrollDOM.dispatchEvent(new Event("scroll"));
  });

  it("returns false (no dispatch) when the anchor isn't in a table", () => {
    const v = build("no table");
    expect(setTablePinHeader(v, 2, true)).toBe(false);
  });
});

describe("[REQ-TBLED-10][REQ-TBLED-11] context-menu display items", () => {
  function openMenu(v: EditorView): HTMLElement {
    const cell = v.contentDOM.querySelector<HTMLElement>("[data-row='0']")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 6, clientY: 6 }));
    return v.dom.querySelector<HTMLElement>(".cm-md-table-menu")!;
  }
  const itemsOf = (menu: HTMLElement) =>
    [...menu.querySelectorAll<HTMLElement>(".cm-md-table-menu-item")];
  const find = (menu: HTMLElement, label: string) =>
    itemsOf(menu).find((b) => b.textContent === label)!;

  it("offers Fit / Overflow / Pin, with Fit checked by default", () => {
    const v = build(DOC);
    const menu = openMenu(v);
    const labels = itemsOf(menu).map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Fit to width", "Overflow (scroll)", "Pin header row"]));
    expect(find(menu, "Fit to width").classList.contains("cm-md-table-menu-item-checked")).toBe(true);
    expect(find(menu, "Overflow (scroll)").classList.contains("cm-md-table-menu-item-checked")).toBe(false);
    expect(find(menu, "Pin header row").classList.contains("cm-md-table-menu-item-checked")).toBe(false);
  });

  it("clicking Overflow flips the display state and re-renders into a scroll box", () => {
    const v = build(DOC);
    find(openMenu(v), "Overflow (scroll)").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(tableDisplayAt(v.state, tbl(v).from, tbl(v).to).width).toBe("overflow");
    expect(count(v, ".cm-md-table-scroll")).toBe(1);
  });

  it("clicking Pin header row records the pin and re-checks on reopen", () => {
    const v = build(DOC);
    find(openMenu(v), "Pin header row").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(tableDisplayAt(v.state, tbl(v).from, tbl(v).to).pin).toBe(true);
    expect(count(v, ".cm-md-table-pin")).toBe(1);
    // Reopen — the item now shows checked.
    expect(find(openMenu(v), "Pin header row").classList.contains("cm-md-table-menu-item-checked")).toBe(true);
  });
});
