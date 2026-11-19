import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpreadsheetChange, SpreadsheetSheet } from '@/services/files';

function columnName(index: number): string {
  let result = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}

type RowProps = {
  row: number; sheet: SpreadsheetSheet; columns: number; selected: string;
  changes: SpreadsheetChange[]; disabled: boolean; onSelect: (cell: string) => void;
};

const Cell = memo(function Cell({ cell, value, changed, selected, disabled, label, onSelect }: {
  cell: string; value: string; changed: boolean; selected: boolean; disabled: boolean;
  label: string; onSelect: (cell: string) => void;
}) {
  return <td data-changed={changed} data-selected={selected}><button type="button" data-cell={cell} disabled={disabled} aria-label={label} aria-pressed={selected} onClick={() => onSelect(cell)}>{value || '\u00a0'}</button></td>;
});

const Row = memo(function Row({ row, sheet, columns, selected, changes, disabled, onSelect }: RowProps) {
  const { t } = useTranslation();
  const changed = new Map(changes.map(change => [change.cell, change]));
  return <tr><th scope="row">{row}</th>{Array.from({ length: columns }, (_, index) => {
    const cell = columnName(index + 1) + row;
    const change = changed.get(cell);
    const value = change ? change.type === 'clear' ? '' : change.value : sheet.cells[cell]?.value ?? '';
    return <Cell key={cell} cell={cell} value={value} changed={!!change} selected={cell === selected} disabled={disabled} label={t('sheet.selectCell', { cell })} onSelect={onSelect} />;
  })}</tr>;
}, (before, after) => before.row === after.row && before.sheet === after.sheet && before.columns === after.columns && before.selected === after.selected && before.disabled === after.disabled && before.onSelect === after.onSelect && before.changes.length === after.changes.length && before.changes.every((change, index) => change === after.changes[index]));

export const SpreadsheetGrid = memo(function SpreadsheetGrid({ sheet, columns, firstRow, rows, selected, changes, disabled, onSelect }: {
  sheet: SpreadsheetSheet; columns: number; firstRow: number; rows: number; selected: string;
  changes: SpreadsheetChange[]; disabled: boolean; onSelect: (cell: string) => void;
}) {
  const byRow = new Map<number, SpreadsheetChange[]>();
  for (const change of changes) {
    const row = Number(change.cell.replace(/^[A-Z]+/, ''));
    const values = byRow.get(row) ?? []; values.push(change); byRow.set(row, values);
  }
  const selectedRow = Number(selected.replace(/^[A-Z]+/, ''));
  return <table className="spreadsheet-grid"><thead><tr><th scope="col">#</th>{Array.from({ length: columns }, (_, index) => <th key={index} scope="col">{columnName(index + 1)}</th>)}</tr></thead>
    <tbody>{Array.from({ length: rows }, (_, index) => {
      const row = firstRow + index;
      return <Row key={row} row={row} sheet={sheet} columns={columns} selected={selectedRow === row ? selected : ''} changes={byRow.get(row) ?? []} disabled={disabled} onSelect={onSelect} />;
    })}</tbody>
  </table>;
});
