import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SetupScoringInputType } from '../../config/setup/template-schema'

export interface CourtInputPreviewProps {
  competitionName: string
  inputType: SetupScoringInputType
}

interface PreviewContent {
  heading: string
  helper: string
  fieldLabel?: string
  options?: string[]
}

function previewContent(inputType: SetupScoringInputType): PreviewContent {
  switch (inputType) {
    case 'RANK':
      return {
        heading: '順位を入力',
        helper: '各チームの順位を入力する画面です。',
        fieldLabel: '順位',
      }
    case 'TIME':
      return {
        heading: 'タイムを入力',
        helper: '計測したタイムを入力する画面です。',
        fieldLabel: 'タイム',
      }
    case 'NUMBER':
      return {
        heading: '記録を入力',
        helper: '回数や得点などの記録を入力する画面です。',
        fieldLabel: '記録',
      }
    case 'WIN_LOSS':
      return {
        heading: '勝敗を入力',
        helper: '試合の結果を選択する画面です。',
        options: ['勝ち', '引き分け', '負け'],
      }
  }
}

export function CourtInputPreview({ competitionName, inputType }: CourtInputPreviewProps) {
  const content = previewContent(inputType)

  return (
    <Card variant="outlined" component="section" aria-label={`${competitionName} の入力プレビュー`}>
      <CardContent>
        <Stack spacing={1.5}>
          <div>
            <Typography component="h3" variant="subtitle1">{content.heading}</Typography>
            <Typography color="text.secondary" variant="body2">{content.helper}</Typography>
          </div>
          {content.fieldLabel ? (
            <TextField
              label={content.fieldLabel}
              placeholder="入力例"
              size="small"
              fullWidth
              disabled
            />
          ) : (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }} aria-label="入力する結果の選択肢">
              {content.options?.map((option) => <Chip key={option} label={option} variant="outlined" />)}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
