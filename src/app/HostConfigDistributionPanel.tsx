import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ConfigDistributionServices } from './config-distribution-service'
import { downloadJsonFile } from './json-file-download'

export interface HostConfigDistributionPanelProps {
  services: Pick<ConfigDistributionServices, 'exportActiveFile'>
  saveFile?: (file: { fileName: string; json: string }) => void
}

export function HostConfigDistributionPanel({
  services,
  saveFile = downloadJsonFile,
}: HostConfigDistributionPanelProps) {
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  const handleSave = async () => {
    setError('')
    setSaved(null)
    try {
      const exported = await services.exportActiveFile()
      saveFile({ fileName: exported.fileName, json: exported.json })
      setSaved(exported.fileName)
    } catch {
      setError('大会設定 JSON を保存できませんでした。')
    }
  }

  return (
    <Stack spacing={2} aria-label="大会設定を配布">
      <div>
        <Typography component="h2" variant="h6">大会設定を配布</Typography>
        <Typography color="text.secondary" variant="body2">
          大会設定 JSON を保存して、全コート端末に同じファイルを渡してください。
        </Typography>
      </div>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? (
        <Alert severity="success">
          {`大会設定 JSON を保存しました。全コート端末に同じファイルを渡してください。（${saved}）`}
        </Alert>
      ) : null}
      <Button variant="contained" onClick={() => { void handleSave() }} sx={{ alignSelf: 'flex-start' }}>
        大会設定 JSON を保存
      </Button>
    </Stack>
  )
}
