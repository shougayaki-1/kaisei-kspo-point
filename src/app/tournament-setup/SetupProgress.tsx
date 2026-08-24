import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'

export const SETUP_STEPS = [
  { key: 'SOURCE', label: '設定の元' },
  { key: 'CHANGES', label: '今年の変更' },
  { key: 'INPUT_AND_SCORING', label: '入力と得点' },
  { key: 'OPERATIONS_CHECK', label: '当日確認' },
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
