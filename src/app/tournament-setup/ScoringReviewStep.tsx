import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { SetupCompetitionDraft } from '../../config/setup/setup-types'
import type { SetupIssue } from '../../config/setup/setup-validation'
import { CourtInputPreview } from './CourtInputPreview'

export interface ScoringReviewStepProps {
  competitions: SetupCompetitionDraft[]
  issues: SetupIssue[]
}

function scoringSummary(competition: SetupCompetitionDraft): string {
  const pointCount = Object.keys(competition.scoring.rankPoints).length
  return pointCount > 0 ? `順位に応じて${pointCount}位まで得点を付けます。` : '順位配点を確認してください。'
}

export function ScoringReviewStep({ competitions, issues }: ScoringReviewStepProps) {
  const scoringIssues = issues.filter((issue) => issue.step === 'SCORING_REVIEW')

  return (
    <Stack spacing={2}>
      <div>
        <Typography component="h2" variant="h6">得点・入力方法の確認</Typography>
        <Typography color="text.secondary">
          コート担当者が当日に見る入力内容と、得点の付け方を確認します。
        </Typography>
      </div>

      {competitions.length === 0 ? (
        <Alert severity="info">競技を追加すると入力方法を確認できます。</Alert>
      ) : competitions.map((competition) => (
        <Card variant="outlined" key={competition.competitionKey}>
          <CardContent>
            <Stack spacing={2}>
              <div>
                <Typography component="h3" variant="subtitle1">{competition.name || '名称未入力の競技'}</Typography>
                <Typography color="text.secondary" variant="body2">{scoringSummary(competition)}</Typography>
              </div>
              <CourtInputPreview competitionName={competition.name || 'この競技'} inputType={competition.scoring.inputType} />
            </Stack>
          </CardContent>
        </Card>
      ))}

      {scoringIssues.map((issue) => (
        <Alert key={`${issue.code}:${issue.competitionKey ?? ''}`} severity="error">
          {issue.message}
        </Alert>
      ))}
    </Stack>
  )
}
