<script lang="ts">
  // A hover-preview grid for choosing a new table's size (M5 S6, REQ-TBLED-1).
  // Hovering (or focusing) a cell highlights the rows×cols rectangle from the top-
  // left; clicking inserts that size. `rows` includes the header row.
  let {
    oninsert,
    max = 8,
  }: {
    oninsert: (rows: number, cols: number) => void;
    max?: number;
  } = $props();

  let hovRow = $state(1);
  let hovCol = $state(1);
  const axis = $derived(Array.from({ length: max }, (_, i) => i));
</script>

<div class="picker">
  <div class="grid" role="grid" aria-label="New table size">
    {#each axis as r (r)}
      <div class="grid-row" role="row">
        {#each axis as c (c)}
          <button
            type="button"
            class="cell"
            class:active={r < hovRow && c < hovCol}
            role="gridcell"
            aria-label={`${r + 1} rows by ${c + 1} columns`}
            onpointerenter={() => {
              hovRow = r + 1;
              hovCol = c + 1;
            }}
            onfocus={() => {
              hovRow = r + 1;
              hovCol = c + 1;
            }}
            onclick={() => oninsert(r + 1, c + 1)}
          ></button>
        {/each}
      </div>
    {/each}
  </div>
  <div class="label">{hovRow} × {hovCol}</div>
</div>

<style>
  .picker {
    padding: 6px 8px 8px;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .grid-row {
    display: flex;
    gap: 3px;
  }
  .cell {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    cursor: pointer;
  }
  .cell.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .label {
    margin-top: 7px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
