import type { BatchId, TournamentId } from '../domain/ids'
import { assembleTransferBatch } from './codec'
import {
  assembleQrFrames,
  decodeQrFrame,
  stableStringify,
  type QrPayloadEnvelope,
} from './frame'
import type { QrFrame, QrPayloadKind, TransferBatch } from './types'

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
  transferId: string
  payloadKind: QrPayloadKind
  totalParts: number
  itemCount: number
  payloadChecksum: string
  parts: Map<number, QrFrame>
}

export class TransferReceiver {
  private readonly batches = new Map<string, BatchAccumulator>()

  constructor(private readonly tournamentId: TournamentId) {}

  async ingest(encoded: string): Promise<TransferProgress> {
    const fragment = await decodeQrFrame(encoded)
    if (fragment.tournamentId !== this.tournamentId) {
      throw new Error('tournament mismatch')
    }

    let accumulator = this.batches.get(fragment.transferId)
    if (!accumulator) {
      accumulator = {
        tournamentId: fragment.tournamentId,
        transferId: fragment.transferId,
        payloadKind: fragment.payloadKind,
        totalParts: fragment.totalParts,
        itemCount: fragment.itemCount,
        payloadChecksum: fragment.payloadChecksum,
        parts: new Map(),
      }
      this.batches.set(fragment.transferId, accumulator)
    } else if (
      accumulator.tournamentId !== fragment.tournamentId ||
      accumulator.payloadKind !== fragment.payloadKind ||
      accumulator.totalParts !== fragment.totalParts ||
      accumulator.itemCount !== fragment.itemCount ||
      accumulator.payloadChecksum !== fragment.payloadChecksum
    ) {
      throw new Error('batch metadata mismatch')
    }

    const existing = accumulator.parts.get(fragment.partIndex)
    if (existing && stableStringify(existing) !== stableStringify(fragment)) {
      throw new Error('conflicting duplicate QR part')
    }
    if (!existing) accumulator.parts.set(fragment.partIndex, fragment)

    return this.progressFor(accumulator)
  }

  getProgress(batchId: BatchId | string): TransferProgress | undefined {
    const accumulator = this.batches.get(batchId)
    return accumulator ? this.progressFor(accumulator) : undefined
  }

  listProgress(): TransferProgress[] {
    return Array.from(this.batches.values(), (accumulator) => this.progressFor(accumulator))
  }

  async getCompletedPayload(transferId: string): Promise<QrPayloadEnvelope> {
    const accumulator = this.batches.get(transferId)
    if (!accumulator) throw new Error('unknown batch')
    const progress = this.progressFor(accumulator)
    if (!progress.complete) throw new Error('batch is incomplete')
    return assembleQrFrames(Array.from(accumulator.parts.values()))
  }

  async getCompletedBatch(batchId: BatchId): Promise<TransferBatch> {
    const accumulator = this.batches.get(batchId)
    if (!accumulator) throw new Error('unknown batch')
    if (accumulator.payloadKind !== 'RESULT_BATCH') throw new Error('batch is not a result batch')
    const progress = this.progressFor(accumulator)
    if (!progress.complete) throw new Error('batch is incomplete')
    return assembleTransferBatch(Array.from(accumulator.parts.values()))
  }

  getFragments(batchId: BatchId | string): QrFrame[] {
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
      batchId: accumulator.transferId as BatchId,
      totalParts: accumulator.totalParts,
      receivedCount,
      remainingCount: accumulator.totalParts - receivedCount,
      missingPartIndexes,
      complete: receivedCount === accumulator.totalParts,
      resultCount: accumulator.itemCount,
    }
  }
}
