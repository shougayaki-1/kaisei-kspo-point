import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { SetupCompetitionDraft } from '../../config/setup/setup-types'
import { CompetitionAdvancedEditor } from './CompetitionAdvancedEditor'
import { CompetitionQuickEditor } from './CompetitionQuickEditor'

export interface CompetitionStepProps {
  competitions: SetupCompetitionDraft[]
  disabled?: boolean
  onCompetitionsChange: (competitions: SetupCompetitionDraft[]) => void
}

export function CompetitionStep({
  competitions,
  disabled = false,
  onCompetitionsChange,
}: CompetitionStepProps) {
  const updateCompetition = (index: number, nextCompetition: SetupCompetitionDraft) => {
    onCompetitionsChange(
      competitions.map((competition, competitionIndex) =>
        competitionIndex === index ? nextCompetition : competition),
    )
  }

  return (
    <Stack spacing={3}>
      <div>
        <Typography component="h2" variant="h6">競技</Typography>
        <Typography color="text.secondary">
          選んだ競技ごとに入力のまとめ方や組数を調整します。
        </Typography>
      </div>

      {competitions.length === 0 ? (
        <Alert severity="info" variant="outlined">
          先にテンプレート手順で使う競技を選んでください。
        </Alert>
      ) : null}

      {competitions.map((competition, index) => (
        <Card key={competition.competitionKey} variant="outlined">
          <CardContent>
            <Stack spacing={2.5}>
              <div>
                <Typography component="h3" variant="h6">
                  {competition.name || `競技 ${index + 1}`}
                </Typography>
                <Typography color="text.secondary">
                  まずはよく使う設定を調整し、必要なら詳細設定を開いてください。
                </Typography>
              </div>

              <CompetitionQuickEditor
                competition={competition}
                disabled={disabled}
                onChange={(nextCompetition) => updateCompetition(index, nextCompetition)}
              />

              <CompetitionAdvancedEditor
                competition={competition}
                disabled={disabled}
                onChange={(nextCompetition) => updateCompetition(index, nextCompetition)}
              />
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  )
}
