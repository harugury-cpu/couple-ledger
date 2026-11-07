import type { CellMerge, MonthLine } from '../db/schema';

export const sheetColumns = ['수단', '항목', '카테고리', '예산', '금액', '이체 계좌', '이체 금액', '남음'] as const;
export type SheetChange = { id: string; col: number; value: string };
export type SheetArea = { row: number; col: number; rows: number; cols: number; manual?: string };
export const cellKey = (row: number, col: number) => `${row}:${col}`;
// 표에 그리는 순서(고정생활비 → 가변생활비 → 저축 → 수입). 셀 좌표의 행 번호는 항상 이 순서를 따른다.
// DB의 sort는 구역을 섞어 매기므로, 그대로 쓰면 병합·선택·붙여넣기가 화면과 다른 줄을 가리킨다.
export const sheetSections = ['fixed', 'variable', 'saving', 'income'] as const;
export function sheetOrder<T extends { section: string }>(lines: T[]): T[] {
  return sheetSections.flatMap(section => lines.filter(line => line.section === section));
}

// Excel·Numbers의 인용된 탭/줄바꿈과 CRLF를 같은 표로 읽는다.
export function parseClipboard(text: string): string[][] {
  const result: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  const input = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"' && (quoted || value === '')) {
      if (quoted && input[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (c === '\t' || c === '\n')) {
      row.push(value); value = '';
      if (c === '\n') { result.push(row); row = []; }
    } else value += c;
  }
  if (quoted) throw new Error('복사한 표의 따옴표가 닫히지 않았습니다.');
  if (value || row.length || !result.length) { row.push(value); result.push(row); }
  const width = Math.max(...result.map(r => r.length));
  return result.map(r => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}
export function formatClipboard(matrix: string[][]) {
  return matrix.map(row => row.map(value => /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join('\t')).join('\n');
}
export function selectionBounds(keys: Set<string>) {
  const coords = [...keys].map(k => k.split(':').map(Number));
  if (!coords.length) return null;
  return { top: Math.min(...coords.map(c => c[0])), bottom: Math.max(...coords.map(c => c[0])), left: Math.min(...coords.map(c => c[1])), right: Math.max(...coords.map(c => c[1])) };
}
export function rectangle(top: number, bottom: number, left: number, right: number) {
  const keys = new Set<string>();
  for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) keys.add(cellKey(row, col));
  return keys;
}
// 순서가 바뀌거나 줄이 지워진 병합은 칸을 숨기지 않는다.
export function manualAreas(lines: MonthLine[], merges: CellMerge[]): SheetArea[] {
  return merges.flatMap(m => {
    const ids = JSON.parse(m.line_ids) as string[];
    const at = ids.map(id => lines.findIndex(l => l.id === id));
    if (!at.length || at.some((n, i) => n < 0 || (i > 0 && n !== at[i - 1] + 1)) || at.some(n => lines[n].section !== m.section)) return [];
    return [{ row: at[0], col: m.first_col, rows: at.length, cols: m.last_col - m.first_col + 1, manual: m.id }];
  });
}
// columns: 표의 열 수(월별 표 8열, 자산 표는 보이는 달 수에 따라 달라진다).
export function layoutAreas(rowCount: number, manual: SheetArea[], automatic: SheetArea[], columns = 8) {
  const cells = new Map<string, SheetArea>();
  for (const area of [...manual, ...automatic]) {
    const keys = rectangle(area.row, area.row + area.rows - 1, area.col, area.col + area.cols - 1);
    if ([...keys].some(k => cells.has(k))) continue;
    for (const key of keys) cells.set(key, area);
  }
  for (let row = 0; row < rowCount; row++) for (let col = 0; col < columns; col++) {
    const key = cellKey(row, col);
    if (!cells.has(key)) cells.set(key, { row, col, rows: 1, cols: 1 });
  }
  return cells;
}
