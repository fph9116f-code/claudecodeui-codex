import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  userDb,
} from '@/modules/database/index.js';

async function withEmptyDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'local-user-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('ensureLocalUser creates the implicit account once and reuses it afterwards', async () => {
  await withEmptyDatabase(() => {
    const first = userDb.ensureLocalUser();

    assert.equal(first.username, 'local');
    assert.ok(Number(first.id) > 0);

    const second = userDb.ensureLocalUser();
    assert.equal(second.id, first.id);
  });
});

test('ensureLocalUser reactivates a local account left inactive by an older install', async () => {
  await withEmptyDatabase(() => {
    const first = userDb.ensureLocalUser();
    getConnection().prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(first.id);

    const reactivated = userDb.ensureLocalUser();

    assert.equal(reactivated.id, first.id);
    assert.equal(reactivated.username, 'local');
  });
});
