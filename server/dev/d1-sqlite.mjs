/* A small Cloudflare D1-compatible wrapper over node:sqlite (for tests and local dev).
 * Supports: prepare(sql).bind(...).first(col?) / all() / run() / raw(), db.batch([...]) (one
 * transaction, rolled back on error) and db.exec(sql), with D1's result shapes. */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

function toSqlValue(v) {
  if (v === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

class Statement {
  constructor(d1, sql, params = []) {
    this.d1 = d1;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.d1, this.sql, params.map(toSqlValue));
  }

  // runs the statement → { rows, changes, lastRowId }
  _exec() {
    const stmt = this.d1.db.prepare(this.sql);
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...this.params).map((r) => ({ ...r }));
      const { c, id } = this.d1.db.prepare('SELECT changes() AS c, last_insert_rowid() AS id').get();
      // a plain SELECT changes nothing; RETURNING statements report their own changes
      return { rows, changes: /^\s*select/i.test(this.sql) ? 0 : Number(c), lastRowId: Number(id) };
    }
    const r = stmt.run(...this.params);
    return { rows: [], changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) };
  }

  _result() {
    const t = Date.now();
    const { rows, changes, lastRowId } = this._exec();
    return {
      success: true,
      results: rows,
      meta: { changes, last_row_id: lastRowId, duration: Date.now() - t, rows_read: rows.length, rows_written: changes, changed_db: changes > 0 },
    };
  }

  async first(col) {
    const { rows } = this._exec();
    const row = rows[0];
    if (!row) return null;
    if (col === undefined) return row;
    if (!(col in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${col})`);
    return row[col];
  }

  async all() { return this._result(); }

  async run() { return this._result(); }

  async raw({ columnNames = false } = {}) {
    const stmt = this.d1.db.prepare(this.sql);
    const rows = stmt.all(...this.params).map((r) => Object.values(r));
    return columnNames ? [stmt.columns().map((c) => c.name), ...rows] : rows;
  }
}

export class D1Database {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) { return new Statement(this, sql); }

  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const out = statements.map((s) => s._result());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql) {
    const t = Date.now();
    this.db.exec(sql);
    return { count: sql.split(';').filter((s) => s.trim()).length, duration: Date.now() - t };
  }

  close() { this.db.close(); }
}

// apply migrations/*.sql in name order, once each (tracked like wrangler's d1_migrations table)
export function applyMigrations(d1, dir = MIGRATIONS_DIR) {
  d1.db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL)');
  const done = new Set(d1.db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    d1.db.exec('BEGIN');
    try {
      d1.db.exec(readFileSync(join(dir, name), 'utf8'));
      d1.db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
      d1.db.exec('COMMIT');
    } catch (e) {
      d1.db.exec('ROLLBACK');
      throw e;
    }
  }
  return d1;
}

export const createD1 = (path = ':memory:') => applyMigrations(new D1Database(path));
