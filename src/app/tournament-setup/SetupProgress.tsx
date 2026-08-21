import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'

export const SETUP_STEPS = [
  { key: 'BASIC', label: '基本情報' },
  { key: 'TEAMS', label: '参加チーム' },
  { key: 'TEMPLATES', label: 'テンプレート' },
  { key: 'COMPETITIONS', label: '競技' },
  { key: 'SCHEDULE', label: '進行' },
  { key: 'SCORING_REVIEW', label: '得点確認' },
  { key: 'FINAL_CHECK', label: '最終確認' },
] as const

export interface SetupProgressProps {
  activeStep: number
}

export function SetupProgress({ activeStep }: SetupProgressProps) {
  return (
    <Stepper activeStep={activeStep} alternativeLabel aria-label="大会セットアップ進捗">
      {SETUP_STEPS.map((step) => (
        <Step key={step.key}>
          <StepLabel>{step.label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  )
}
