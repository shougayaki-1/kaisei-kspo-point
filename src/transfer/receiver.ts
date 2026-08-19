import type { BatchId, TournamentId } from '../domain/ids'
import { assembleTransferBatch, decodeQrFragment } from './codec'
import type { TransferBatch, TransferQrFragment } from './types'

export interface TransferProgress {
  batchId: BatchId
  totalParts: number
  receivedCount: number
  remainingCount: number
  missingPartIndexes: number[]
  complete: boolean
  resultCount: number
}

interface BatchAccumulator {
  tournamentId: TournamentId
  batchId: BatchId
  totalParts: number
  resultCount: number
  batchChecksum: string
  parts: Map<number, TransferQrFragment>
}

export class TransferReceiver {
  private readonly batches = new Map<string, BatchAccumulator>()

  constructor(private readonly tournamentId: TournamentId) {}

  async ingest(encoded: string): Promise<TransferProgress> {
    const fragment = await decodeQrFragment(encoded)
    if (fragment.tournamentId !== this.tournamentId) {
      throw new Error('tournament mismatch')
    }

    let accumulator = this.batches.get(fragment.batchId)
    if (!accumulator) {
      accumulator = {
        tournamentId: fragment.tournamentId,
        batchId: fragment.batchId,
        totalParts: fragment.totalParts,
        resultCount: fragment.resultCount,
        batchChecksum: fragment.batchChecksum,
        parts: new Map(),
      }
      this.batches.set(fragment.batchId, accumulator)
    } else if (
      accumulator.tournamentId !== fragment.tournamentId ||
      accumulator.totalParts !== fragment.totalParts ||
      accumulator.resultCount !== fragment.resultCount ||
      accumulator.batchChecksum !== fragment.batchChecksum
    ) {
      throw new Error('batch metadata mismatch')
    }

    const existing = accumulator.parts.get(fragment.partIndex)
    if (existing && existing.payload !== fragment.payload) {
      throw new Error('conflicting duplicate QR part')
    }
    if (!existing) accumulator.parts.set(fragment.partIndex, fragment)

    return this.progressFor(accumulator)
  }

  getProgress(batchId: BatchId): TransferProgress | undefined {
    const accumulator = this.batches.get(batchId)
    return accumulator ? this.progressFor(accumulator) : undefined
  }

  listProgress(): TransferProgress[] {
    return Array.from(this.batches.values(), (accumulator) => this.progressFor(accumulator))
  }

  async getCompletedBatch(batchId: BatchId): Promise<TransferBatch> {
    const accumulator = this.batches.get(batchId)
    if (!accumulator) throw new Error('unknown batch')
    const progress = this.progressFor(accumulator)
    if (!progress.complete) throw new Error('batch is incomplete')
    return assembleTransferBatch(Array.from(accumulator.parts.values()))
  }

  getFragments(batchId: BatchId): TransferQrFragment[] {
    const accumulator = this.batches.get(batchId)
    if (!accumulator) return []
    return Array.from(accumulator.parts.values()).sort((left, right) => left.partIndex - right.partIndex)
  }

  private progressFor(accumulator: BatchAccumulator): TransferProgress {
    const missingPartIndexes: number[] = []
    for (let partIndex = 1; partIndex <= accumulator.totalParts; partIndex += 1) {
      if (!accumulator.parts.has(partIndex)) missingPartIndexes.push(partIndex)
    }
    const receivedCount = accumulator.parts.size
    return {
      batchId: accumulator.batchId,
      totalParts: accumulator.totalParts,
      receivedCount,
      remainingCount: accumulator.totalParts - receivedCount,
      missingPartIndexes,
      complete: receivedCount === accumulator.totalParts,
      resultCount: accumulator.resultCount,
    }
  }
}
