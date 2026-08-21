import { useEffect, useRef } from 'react'
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
  focusedCompetitionKey?: string
  onCompetitionsChange: (competitions: SetupCompetitionDraft[]) => void
}

export function CompetitionStep({
  competitions,
  disabled = false,
  focusedCompetitionKey,
  onCompetitionsChange,
}: CompetitionStepProps) {
  const cardRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (!focusedCompetitionKey) return
    const card = cardRefs.current.get(focusedCompetitionKey)
    if (!card) return
    if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' })
    card.focus()
  }, [focusedCompetitionKey])

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

      {competitions.map((competition, index) => {
        const focused = competition.competitionKey === focusedCompetitionKey
        const competitionName = competition.name || `競技 ${index + 1}`

        return (
        <Card
          key={competition.competitionKey}
          component="section"
          variant="outlined"
          ref={(element) => {
            if (element) cardRefs.current.set(competition.competitionKey, element)
            else cardRefs.current.delete(competition.competitionKey)
          }}
          tabIndex={-1}
          aria-label={`${competitionName} の競技設定`}
          data-focus-target={focused ? 'true' : undefined}
          sx={focused ? { borderColor: 'primary.main', boxShadow: 2 } : undefined}
        >
          <CardContent>
            <Stack spacing={2.5}>
              <div>
                <Typography component="h3" variant="h6">
                  {competitionName}
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
        )
      })}
    </Stack>
  )
}
