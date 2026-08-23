import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { validateTournamentConfig, type TournamentConfigSnapshot } from '../../config/tournament-config'
import type { SetupStep } from '../../config/setup/setup-types'
import { CourtAssignmentQrPanel } from './CourtAssignmentQrPanel'
import { OperationsPreview } from './OperationsPreview'

export interface TournamentSettingsHomeProps {
  snapshot: TournamentConfigSnapshot
  onOpenStage: (step: SetupStep) => void
  advancedManagement: ReactNode
}

type SettingsView = 'HOME' | 'DISTRIBUTION' | 'ADVANCED'

interface SettingsCard {
  key: string
  title: string
  summary: string
  action: () => void
  actionLabel: string
}

export function TournamentSettingsHome({ snapshot, onOpenStage, advancedManagement }: TournamentSettingsHomeProps) {
  const [view, setView] = useState<SettingsView>('HOME')

  const issues = useMemo(() => validateTournamentConfig(snapshot), [snapshot])
  const errorCount = issues.filter((issue) => issue.severity === 'ERROR').length
  const warningCount = issues.filter((issue) => issue.severity === 'WARNING').length

  if (view === 'DISTRIBUTION') {
    return (
      <Stack spacing={2}>
        <Button variant="text" onClick={() => setView('HOME')}>← 大会設定に戻る</Button>
        <CourtAssignmentQrPanel snapshot={snapshot} />
      </Stack>
    )
  }

  if (view === 'ADVANCED') {
    return (
      <Stack spacing={2}>
        <Button variant="text" onClick={() => setView('HOME')}>← 大会設定に戻る</Button>
        {advancedManagement}
      </Stack>
    )
  }

  const cards: SettingsCard[] = [
    {
      key: 'basic',
      title: '基本情報・チーム',
      summary: `${snapshot.tournament.name || '未入力'} / ${snapshot.teams.length}組`,
      action: () => onOpenStage('CHANGES'),
      actionLabel: '編集する',
    },
    {
      key: 'competitions',
      title: '競技・入力方式',
      summary: `${snapshot.competitions.length}競技 / 得点計算テスト ${snapshot.scoringTestCases.length}件`,
      action: () => onOpenStage('INPUT_AND_SCORING'),
      actionLabel: '編集する',
    },
    {
      key: 'schedule',
      title: '時程・コート',
      summary: `${snapshot.scheduleSlots.length}回展開 / コート${snapshot.courtStations.length}か所`,
      action: () => onOpenStage('CHANGES'),
      actionLabel: '編集する',
    },
    {
      key: 'distribution',
      title: 'コート端末への配布',
      summary: `コート${snapshot.courtStations.length}か所へQRを発行できます`,
      action: () => setView('DISTRIBUTION'),
      actionLabel: 'QRを表示',
    },
    {
      key: 'validation',
      title: '検証結果',
      summary: errorCount > 0 ? `エラー${errorCount}件` : warningCount > 0 ? `警告${warningCount}件` : '問題はありません',
      action: () => onOpenStage('OPERATIONS_CHECK'),
      actionLabel: '確認する',
    },
    {
      key: 'advanced',
      title: '詳細管理',
      summary: 'JSONの入出力やバージョン履歴、計算過程の確認はこちら',
      action: () => setView('ADVANCED'),
      actionLabel: '開く',
    },
  ]

  return (
    <Stack spacing={3}>
      <div>
        <Typography component="h1" variant="h5">{snapshot.tournament.name || '大会設定'}</Typography>
        <Typography color="text.secondary">大会の設定内容と当日の運用準備を確認できます。</Typography>
      </div>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}
      >
        {cards.map((card) => (
          <Card key={card.key} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1">{card.title}</Typography>
                {card.key === 'validation' && errorCount > 0 ? (
                  <Chip size="small" color="error" label={`${errorCount}`} />
                ) : null}
              </Stack>
              <Typography color="text.secondary" variant="body2">{card.summary}</Typography>
            </CardContent>
            <CardActions>
              <Button size="small" onClick={card.action}>{card.actionLabel}</Button>
            </CardActions>
          </Card>
        ))}
      </Box>

      <OperationsPreview snapshot={snapshot} />
    </Stack>
  )
}
