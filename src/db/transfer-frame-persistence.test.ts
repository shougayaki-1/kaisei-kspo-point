import { afterEach, describe, expect, it } from 'vitest'
import type { TournamentId } from '../domain/ids'
import { encodeQrFrames } from '../transfer/frame'
import { createDatabase, type AppDatabase } from './database'
import { TransferRepository } from './transfer-repository'

const tournamentId = 'tournament-1' as TournamentId
const openDatabases: AppDatabase[] = []
const databaseNames = new Set<string>()

function open(name: string): AppDatabase {
  databaseNames.add(name)
  const db = createDatabase(name)
  openDatabases.push(db)
  return db
}

afterEach(async () => {
  for (const db of openDatabases.splice(0)) db.close()
  for (const name of databaseNames) {
    const db = createDatabase(name)
    await db.delete()
  }
  databaseNames.clear()
})

describe('common QR partial persistence', () => {
  it('restores a partial CONFIG_UPDATE session and completes after reload', async () => {
    const name = `common-frame-${crypto.randomUUID()}`
    const transferId = 'config-transfer-12'
    const payload = {
      payloadKind: 'CONFIG_UPDATE' as const,
      tournamentId,
      transferId,
      itemCount: 1,
      payload: { type: 'CONFIG_UPDATE', configVersionId: 'config-12', note: 'x'.repeat(500) },
    }
    const encoded = await encodeQrFrames(payload, 80)
    expect(encoded.length).toBeGreaterThan(2)

    const firstRepository = new TransferRepository(open(name))
    await firstRepository.saveReceivedPart(encoded[1], '2026-08-19T12:00:00+09:00')
    await firstRepository.saveReceivedPart(encoded[0], '2026-08-19T12:00:01+09:00')
    openDatabases.at(-1)?.close()

    const secondRepository = new TransferRepository(open(name))
    const restored = await secondRepository.restoreReceiver(tournamentId)
    expect(restored.getProgress(transferId as never)).toMatchObject({
      totalParts: encoded.length,
      receivedCount: 2,
      complete: false,
    })

    for (const part of encoded.slice(2).reverse()) {
      await secondRepository.saveReceivedPart(part, '2026-08-19T12:01:00+09:00')
    }
    const completed = await secondRepository.restoreReceiver(tournamentId)
    await expect(completed.getCompletedPayload(transferId)).resolves.toEqual(payload)
  })
})
