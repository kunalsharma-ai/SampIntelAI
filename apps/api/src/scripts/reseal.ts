import 'reflect-metadata';
import pg from 'pg';
import { Sealer } from '../crypto/sealer.js';

/**
 * Key rotation, step 3: re-seal every sealed column with the current FIELD_ENCRYPTION_KEY.
 * Needs FIELD_ENCRYPTION_KEY (new) and FIELD_ENCRYPTION_KEY_PREVIOUS (old), and DATABASE_ADMIN_URL (row-level
 * security would hide other tenants' rows from the app role). One transaction: either every value moves or none.
 * Safe to run twice: values the current key already opens are left alone. Prints counts, never values.
 */
const url = process.env.DATABASE_ADMIN_URL;
const key = process.env.FIELD_ENCRYPTION_KEY;
const previous = process.env.FIELD_ENCRYPTION_KEY_PREVIOUS;
if (!url || !key || !previous) throw new Error('DATABASE_ADMIN_URL, FIELD_ENCRYPTION_KEY and FIELD_ENCRYPTION_KEY_PREVIOUS are required');
const sealer = new Sealer(key, previous);

type Row = { id: string; v: string; tenant_id?: string; provider?: string };
const COLUMNS: { table: string; column: string; extra: string; context: (r: Row) => string }[] = [
  { table: 'users', column: 'totp_secret', extra: '', context: (r) => `totp:${r.id}` },
  {
    table: 'provider_configurations',
    column: 'sealed_key',
    extra: ', tenant_id, provider',
    context: (r) => `provider:${r.tenant_id}:${r.provider}`,
  },
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');
  for (const c of COLUMNS) {
    const { rows } = await client.query<Row>(
      `select id, ${c.column} as v${c.extra} from ${c.table} where ${c.column} is not null for update`,
    );
    let moved = 0;
    for (const r of rows) {
      let opened: { plain: string; keyIndex: number };
      try {
        opened = sealer.openWithKey(r.v, c.context(r));
      } catch {
        throw new Error(`${c.table}.${c.column} for id=${r.id} opens with neither key; nothing was changed`);
      }
      if (opened.keyIndex === 0) continue;
      await client.query(`update ${c.table} set ${c.column} = $1 where id = $2`, [sealer.seal(opened.plain, c.context(r)), r.id]);
      moved++;
    }
    console.log(`${c.table}.${c.column}: ${rows.length} sealed, ${moved} re-sealed`);
  }
  await client.query('commit');
  console.log('re-seal complete: FIELD_ENCRYPTION_KEY_PREVIOUS can now be removed');
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  await client.end();
}
