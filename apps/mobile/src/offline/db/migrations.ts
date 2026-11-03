/**
 * Migrations of the local database, in order (ADR 0065). The number of a
 * migration is its position plus one, recorded in `PRAGMA user_version`;
 * each one runs in its own transaction. A published migration is never
 * edited: a change is a new one at the end. They must create exactly the
 * tables of `schema.ts` (`database.test.ts` compares them).
 */
export const LOCAL_MIGRATIONS: readonly string[] = [
  // 1. Local database and sync queue (B-502).
  `
  CREATE TABLE device_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE sync_scope (
    membership_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    cursor TEXT,
    collections TEXT,
    last_pushed_at INTEGER,
    last_pulled_at INTEGER,
    last_synced_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE synced_row (
    membership_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    client_uuid TEXT,
    player_id TEXT,
    parent_id TEXT,
    category_id TEXT,
    local_date TEXT,
    data TEXT NOT NULL,
    pulled_at INTEGER NOT NULL,
    CONSTRAINT synced_row_pk PRIMARY KEY (membership_id, collection, id),
    CONSTRAINT synced_row_scope_fk FOREIGN KEY (membership_id)
      REFERENCES sync_scope (membership_id) ON DELETE CASCADE
  );
  CREATE INDEX synced_row_client_uuid_idx ON synced_row (membership_id, collection, client_uuid);
  CREATE INDEX synced_row_player_idx ON synced_row (membership_id, collection, player_id, local_date);
  CREATE INDEX synced_row_parent_idx ON synced_row (membership_id, collection, parent_id);
  CREATE INDEX synced_row_date_idx ON synced_row (membership_id, collection, local_date);

  CREATE TABLE mutation (
    seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    membership_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    op TEXT NOT NULL,
    hlc TEXT NOT NULL,
    input TEXT NOT NULL,
    targets TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'acked')),
    attempts INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    acked_at INTEGER,
    CONSTRAINT mutation_scope_fk FOREIGN KEY (membership_id)
      REFERENCES sync_scope (membership_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX mutation_mutation_id_key ON mutation (mutation_id);
  CREATE INDEX mutation_scope_state_idx ON mutation (membership_id, state, seq);

  CREATE TABLE sync_issue (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    membership_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    op TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('rejected', 'superseded')),
    error_code TEXT,
    error_paths TEXT,
    fields TEXT,
    input TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    CONSTRAINT sync_issue_scope_fk FOREIGN KEY (membership_id)
      REFERENCES sync_scope (membership_id) ON DELETE CASCADE
  );
  CREATE INDEX sync_issue_scope_idx ON sync_issue (membership_id, id);
  `,
];
