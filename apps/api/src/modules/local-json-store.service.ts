import { Injectable } from "@nestjs/common";
import type { MemoryEntry } from "@sp-agent/shared";
import { mkdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

@Injectable()
export class LocalJsonStore {
  private readonly dataDir = resolve(process.env.SP_AGENT_DATA_DIR ?? ".sp-agent-data");
  private database: DatabaseSync | undefined;

  async read<T>(name: string, fallback: T): Promise<T> {
    const row = this.db().prepare("select value_json from app_state where key = ?").get(name) as { value_json?: string } | undefined;
    if (row?.value_json) return JSON.parse(row.value_json) as T;

    // One-time compatibility path for installations created before SQLite storage.
    try {
      const raw = await readFile(this.pathFor(name), "utf8");
      const value = JSON.parse(raw) as T;
      await this.write(name, value);
      await rm(this.pathFor(name), { force: true });
      return value;
    } catch (error) {
      if (isMissingFile(error)) return fallback;
      throw error;
    }
  }

  async write<T>(name: string, value: T): Promise<void> {
    this.db().prepare(
      `insert into app_state (key, value_json, updated_at) values (?, ?, ?)
       on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(name, JSON.stringify(value), new Date().toISOString());
  }

  /**
   * Memory remains application state in SQLite. FTS is intentionally a
   * rebuildable index so a damaged index can never become the source of truth.
   */
  async syncMemoryFts(entries: MemoryEntry[]): Promise<void> {
    const database = this.db();
    database.exec("begin immediate");
    try {
      database.exec("delete from memory_fts");
      const insert = database.prepare("insert into memory_fts (memory_id, content, tags) values (?, ?, ?)");
      for (const entry of entries) {
        if (entry.status === "tombstoned") continue;
        insert.run(entry.id, entry.content, entry.tags.join(" "));
      }
      database.exec("commit");
    } catch (error) {
      database.exec("rollback");
      throw error;
    }
  }

  async searchMemoryFts(query: string, limit: number): Promise<string[]> {
    const terms = query
      .trim()
      .split(/\s+/u)
      .map((term) => term.replaceAll('"', "").trim())
      .filter(Boolean)
      .slice(0, 12);
    if (terms.length === 0) return [];
    const match = terms.map((term) => `"${term}"`).join(" OR ");
    const rows = this.db()
      .prepare("select memory_id from memory_fts where memory_fts match ? order by bm25(memory_fts) limit ?")
      .all(match, limit) as Array<{ memory_id: string }>;
    return rows.map((row) => row.memory_id);
  }

  /** Execute a read-modify-write cycle under SQLite's writer lock. */
  async mutate<T, R>(name: string, fallback: T, mutation: (value: T) => R): Promise<R> {
    const database = this.db();
    database.exec("begin immediate");
    try {
      const row = database.prepare("select value_json from app_state where key = ?").get(name) as { value_json?: string } | undefined;
      const value = row?.value_json ? JSON.parse(row.value_json) as T : fallback;
      const result = mutation(value);
      database.prepare(
        `insert into app_state (key, value_json, updated_at) values (?, ?, ?)
         on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at`
      ).run(name, JSON.stringify(value), new Date().toISOString());
      database.exec("commit");
      return result;
    } catch (error) {
      database.exec("rollback");
      throw error;
    }
  }

  pathFor(name: string): string {
    return resolve(this.dataDir, name);
  }

  private db() {
    if (this.database) return this.database;
    const databaseFile = resolve(this.dataDir, "sp-agent.sqlite");
    mkdirSync(this.dataDir, { recursive: true });
    this.database = new DatabaseSync(databaseFile);
    this.database.exec(`
      pragma journal_mode = WAL;
      pragma foreign_keys = ON;
      create table if not exists app_state (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );
      create virtual table if not exists memory_fts using fts5(
        memory_id unindexed,
        content,
        tags,
        tokenize = 'unicode61'
      );
    `);
    return this.database;
  }
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
