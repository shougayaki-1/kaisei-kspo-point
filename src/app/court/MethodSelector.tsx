import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ResultEntryMethodDefinition } from '../../config/result-entry-policy'

export interface MethodSelectorProps {
  allowedMethods: ResultEntryMethodDefinition[]
  selectedMethodKey: string
  /** True when the current input has values that would be lost on switching methods. */
  hasEnteredValues: boolean
  onSelect: (methodKey: string) => void
}

export function MethodSelector({ allowedMethods, selectedMethodKey, hasEnteredValues, onSelect }: MethodSelectorProps) {
  const [open, setOpen] = useState(false)
  const [pendingMethodKey, setPendingMethodKey] = useState<string | null>(null)
  const current = allowedMethods.find((method) => method.methodKey === selectedMethodKey)

  if (allowedMethods.length <= 1) {
    return (
      <Typography variant="body2" color="text.secondary">入力方法: {current?.label ?? selectedMethodKey}</Typography>
    )
  }

  const requestSwitch = (methodKey: string) => {
    if (methodKey === selectedMethodKey) {
      setOpen(false)
      return
    }
    if (hasEnteredValues) {
      setPendingMethodKey(methodKey)
      return
    }
    onSelect(methodKey)
    setOpen(false)
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="body2">入力方法: {current?.label ?? selectedMethodKey}</Typography>
      <Button size="small" variant="text" onClick={() => setOpen(true)}>変更</Button>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>入力方法を選ぶ</DialogTitle>
        <DialogContent>
          <RadioGroup
            value={selectedMethodKey}
            onChange={(event) => requestSwitch(event.target.value)}
          >
            {allowedMethods.map((method) => (
              <FormControlLabel key={method.methodKey} value={method.methodKey} control={<Radio />} label={method.label} />
            ))}
          </RadioGroup>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingMethodKey !== null} onClose={() => setPendingMethodKey(null)}>
        <DialogTitle>入力方法を変更しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            入力方法を変更すると、これまで入力した値は消去されます。よろしいですか？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingMethodKey(null)}>キャンセル</Button>
          <Button
            color="warning"
            onClick={() => {
              if (pendingMethodKey) onSelect(pendingMethodKey)
              setPendingMethodKey(null)
              setOpen(false)
            }}
          >
            変更する
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
