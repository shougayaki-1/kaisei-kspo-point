import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { CanonicalCompetitionResult } from '../../domain/result-entry-projection'
import type { CompetitionEntryId } from '../../domain/ids'

export interface ResultPreviewProps {
  projection: CanonicalCompetitionResult
  entryLabels: Record<CompetitionEntryId, string>
}

const OUTCOME_LABEL: Record<string, string> = {
  WIN: '勝ち',
  LOSS: '負け',
  DRAW: '引き分け',
}

export function ResultPreview({ projection, entryLabels }: ResultPreviewProps) {
  const rows = [...projection.entries].sort((left, right) => left.rank - right.rank)

  return (
    <Stack spacing={1} aria-label="結果プレビュー">
      <Typography variant="subtitle2">この内容で保存します</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>順位</TableCell>
            <TableCell>参加者</TableCell>
            <TableCell>結果</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.entryId}>
              <TableCell>{row.rank}位</TableCell>
              <TableCell>{entryLabels[row.entryId] ?? row.entryId}</TableCell>
              <TableCell>
                {row.outcome ? OUTCOME_LABEL[row.outcome] ?? row.outcome : String(row.comparisonValue ?? '')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}
