import type { Table } from 'dexie'
import { stableStringify } from '../transfer/frame'
import { HOST_BACKUP_TABLE_NAMES, type HostBackupTables } from '../backup/backup-schema'
import type { AppDatabase } from './database'

function resolveBackupTables(db: AppDatabase): Table<unknown, unknown>[] {
  const byName = new Map(db.tables.map((table) => [table.name, table]))
  const tables = HOST_BACKUP_TABLE_NAMES.map((name) => {
    const table = byName.get(name)
    if (!table) throw new Error(`backup table is missing: ${name}`)
    return table as Table<unknown, unknown>
  })
  if (byName.size !== tables.length) {
    const unlisted = db.tables
      .map((table) => table.name)
      .filter((name) => !HOST_BACKUP_TABLE_NAMES.includes(name as typeof HOST_BACKUP_TABLE_NAMES[number]))
    throw new Error(`backup table list is out of sync: ${unlisted.join(', ')}`)
  }
  return tables
}

async function readSnapshot(db: AppDatabase): Promise<HostBackupTables> {
  const entries = await Promise.all(HOST_BACKUP_TABLE_NAMES.map(async (name) => [
    name,
    structuredClone(await db.table(name).toArray()),
  ] as const))
  return Object.fromEntries(entries) as HostBackupTables
}

export async function exportHostDatabaseSnapshot(db: AppDatabase): Promise<HostBackupTables> {
  const tables = resolveBackupTables(db)
  return db.transaction('r', tables, () => readSnapshot(db))
}

export async function replaceHostDatabaseSnapshot(
  db: AppDatabase,
  snapshot: HostBackupTables,
): Promise<void> {
  const tables = resolveBackupTables(db)
  await db.transaction('rw', tables, async () => {
    for (const table of tables) await table.clear()
    for (const name of HOST_BACKUP_TABLE_NAMES) {
      const rows = structuredClone(snapshot[name]) as unknown[]
      if (rows.length > 0) await (db.table(name) as Table<unknown, unknown>).bulkAdd(rows)
    }

    const readBack = await readSnapshot(db)
    if (stableStringify(readBack) !== stableStringify(snapshot)) {
      throw new Error('post-restore database verification failed')
    }
  })
}
