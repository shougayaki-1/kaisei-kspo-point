import type { AppDatabase } from './database'

export const DATA_RESET_TABLE_NAMES = [
  'appMeta',
  'tournaments',
  'teams',
  'competitions',
  'competitionEntries',
  'scheduleSlots',
  'courtRuns',
  'scoringSessions',
  'inputSchemas',
  'scoringProfiles',
  'scoringTestCases',
  'configVersions',
  'results',
  'resultRevisions',
  'conflictResolutions',
  'transferBatches',
  'receivedQrParts',
  'acknowledgements',
  'revisionDeliveries',
  'operators',
  'auditEvents',
  'localSettings',
] as const

export const DATA_RESET_TARGETS = [
  { label: '大会・チーム・競技・進行設定', detail: 'Tournament / Team / Competition / schedule / court / scoring session' },
  { label: 'ConfigVersion・得点設定・得点テスト承認', detail: 'input schema / scoring profile / ScoringTestCase / active ConfigVersion state' },
  { label: '結果・修正履歴・競合解決', detail: 'Result / ResultRevision / conflict resolution' },
  { label: 'QR転送・受信途中データ・ACK履歴', detail: 'TransferBatch / received QR parts / ACK / revision delivery history' },
  { label: '端末内の運用メタデータ', detail: 'operator / audit / local settings / app metadata' },
] as const

export async function resetAllPersistentData(db: AppDatabase): Promise<void> {
  const tablesByName = new Map(db.tables.map((table) => [table.name, table]))
  const resetTables = DATA_RESET_TABLE_NAMES.map((name) => {
    const table = tablesByName.get(name)
    if (!table) throw new Error(`reset table is missing: ${name}`)
    return table
  })

  if (tablesByName.size !== resetTables.length) {
    const unlisted = db.tables
      .map((table) => table.name)
      .filter((name) => !DATA_RESET_TABLE_NAMES.includes(name as typeof DATA_RESET_TABLE_NAMES[number]))
    throw new Error(`reset table list is out of sync: ${unlisted.join(', ')}`)
  }

  await db.transaction('rw', resetTables, async () => {
    for (const table of resetTables) await table.clear()
  })
}
