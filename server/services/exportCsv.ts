import type { Db } from '../db/open.ts';
import { all } from '../db/open.ts';
import { serializeCsv } from '../../shared/csv.ts';
import { CSV_HEADER } from '../../shared/constants.ts';

export function exportCsv(db: Db, includeZero = false): string {
  const rows = all<{ card_id: string; set_code: string; number: string; name: string; finish: string; qty: number; note: string }>(
    db,
    `SELECT i.card_id, c.set_code, c.number, c.name, i.finish, i.qty, i.note
     FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.code = c.set_code
     WHERE ${includeZero ? "(i.qty > 0 OR i.note <> '')" : 'i.qty > 0'}
     ORDER BY s.sort_order, s.release_date, c.set_code, c.number_int, c.number, i.finish`,
  );
  return serializeCsv([[...CSV_HEADER], ...rows.map((r) => [r.card_id, r.set_code, r.number, r.name, r.finish, Number(r.qty), r.note])], { bom: true });
}
