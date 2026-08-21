import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { validateTournamentConfig, type TournamentConfigSnapshot } from '../../config/tournament-config'
import { compileTournamentSetup } from '../../config/setup/setup-compiler'
import { mapConfigIssuesToSetupIssues, validateSetupDraft, type SetupIssue } from '../../config/setup/setup-validation'
import type {
  SetupDraftRepository,
  SetupStep,
  SetupTeamDraft,
  TournamentSetupDraft,
} from '../../config/setup/setup-types'
import { BasicStep } from './BasicStep'
import { CompetitionStep } from './CompetitionStep'
import { ScheduleStep } from './ScheduleStep'
import { ScoringReviewStep } from './ScoringReviewStep'
import { SetupProgress, SETUP_STEPS } from './SetupProgress'
import { TemplateStep } from './TemplateStep'
import { TeamsStep } from './TeamsStep'
import { FinalCheckStep } from './FinalCheckStep'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface TournamentSetupWizardProps {
  repository: SetupDraftRepository
  onCancel: () => void
  onReadyToApply: (snapshot: TournamentConfigSnapshot, draft: TournamentSetupDraft) => void
}

interface PendingSave {
  id: number
  draft: TournamentSetupDraft
}

interface FinalCheckState {
  snapshot?: TournamentConfigSnapshot
  issues: SetupIssue[]
}

function mergeFinalCheckIssues(
  setupIssues: SetupIssue[],
  mappedDomainIssues: SetupIssue[],
): SetupIssue[] {
  return [
    ...setupIssues,
    ...mappedDomainIssues.filter((issue) => {
      if (issue.code === 'EMPTY_LABEL' && issue.step === 'BASIC') {
        return !setupIssues.some((setupIssue) => setupIssue.code === 'EMPTY_TOURNAMENT_NAME')
      }

      if (issue.code === 'EMPTY_RANK_POINTS') {
        return !setupIssues.some((setupIssue) => (
          setupIssue.code === 'SCORING_CONFIRMATION_REQUIRED'
          && setupIssue.competitionKey === issue.competitionKey
        ))
      }

      return true
    }),
  ]
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function createDraftTimestamp(): string {
  return new Date().toISOString()
}

function createDefaultDraft(): TournamentSetupDraft {
  const now = createDraftTimestamp()

  return {
    draftFormatVersion: 1,
    draftId: createId('setup-draft'),
    createdAt: now,
    updatedAt: now,
    currentStep: 'BASIC',
    tournament: {
      name: '',
    },
    teams: [],
    templateSource: {
      type: 'NONE',
    },
    competitions: [],
  }
}

function cloneDraft(draft: TournamentSetupDraft): TournamentSetupDraft {
  return structuredClone(draft)
}

function defaultTeamName(index: number): string {
  return `${index + 1}組`
}

function resizeTeams(currentTeams: SetupTeamDraft[], requestedCount: number): SetupTeamDraft[] {
  const nextCount = Math.max(0, requestedCount)
  const nextTeams = currentTeams.slice(0, nextCount).map((team) => ({ ...team }))

  for (let index = nextTeams.length; index < nextCount; index += 1) {
    nextTeams.push({
      teamKey: createId('team'),
      name: defaultTeamName(index),
    })
  }

  return nextTeams
}

function saveStateText(state: SaveState): string | null {
  switch (state) {
    case 'saving':
      return '保存中...'
    case 'saved':
      return '保存済み'
    default:
      return null
  }
}

export function TournamentSetupWizard({
  repository,
  onCancel,
  onReadyToApply,
}: TournamentSetupWizardProps) {
  const [draft, setDraft] = useState<TournamentSetupDraft>(() => createDefaultDraft())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [hydrated, setHydrated] = useState(false)
  const [focusedCompetitionKey, setFocusedCompetitionKey] = useState<string | undefined>()

  const mountedRef = useRef(true)
  const hasLocalEditsRef = useRef(false)
  const needsAutosaveRef = useRef(false)
  const saveQueueRef = useRef<PendingSave | null>(null)
  const nextSaveIdRef = useRef(0)
  const savingRef = useRef(false)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let ignore = false

    void repository.loadSetupDraft()
      .then((loadedDraft) => {
        if (ignore || !loadedDraft || hasLocalEditsRef.current) return
        setDraft(cloneDraft(loadedDraft))
      })
      .finally(() => {
        if (!ignore) setHydrated(true)
      })

    return () => {
      ignore = true
    }
  }, [repository])

  const flushSaves = useCallback(async () => {
    if (savingRef.current) return

    savingRef.current = true

    try {
      while (saveQueueRef.current) {
        const currentSave = saveQueueRef.current
        saveQueueRef.current = null

        try {
          await repository.saveSetupDraft(currentSave.draft)
          if (!mountedRef.current) return

          if (saveQueueRef.current || currentSave.id !== nextSaveIdRef.current) {
            setSaveState('saving')
            continue
          }

          setSaveState('saved')
        } catch {
          if (!mountedRef.current) return

          if (saveQueueRef.current || currentSave.id !== nextSaveIdRef.current) {
            setSaveState('saving')
            continue
          }

          setSaveState('error')
        }
      }
    } finally {
      savingRef.current = false
    }

    if (saveQueueRef.current) {
      void flushSaves()
    }
  }, [repository])

  const queueSave = useCallback((nextDraft: TournamentSetupDraft) => {
    const nextSaveId = nextSaveIdRef.current + 1
    nextSaveIdRef.current = nextSaveId
    saveQueueRef.current = {
      id: nextSaveId,
      draft: cloneDraft(nextDraft),
    }
    setSaveState('saving')
    void flushSaves()
  }, [flushSaves])

  useEffect(() => {
    if (!hydrated || !needsAutosaveRef.current) return
    needsAutosaveRef.current = false
    queueSave(draft)
  }, [draft, hydrated, queueSave])

  const updateDraft = useCallback((mutate: (nextDraft: TournamentSetupDraft) => void) => {
    hasLocalEditsRef.current = true

    setDraft((currentDraft) => {
      const nextDraft = cloneDraft(currentDraft)
      mutate(nextDraft)
      nextDraft.updatedAt = createDraftTimestamp()
      needsAutosaveRef.current = true
      return nextDraft
    })
  }, [])

  const activeStep = useMemo(
    () => Math.max(0, SETUP_STEPS.findIndex((step) => step.key === draft.currentStep)),
    [draft.currentStep],
  )

  const canGoBack = activeStep > 0
  const canGoNext = activeStep < SETUP_STEPS.length - 1
  const controlsDisabled = !hydrated

  const saveText = saveStateText(saveState)

  const finalCheck = useMemo<FinalCheckState>(() => {
    const setupIssues = validateSetupDraft(draft)

    try {
      const snapshot = compileTournamentSetup(draft)
      const domainIssues = validateTournamentConfig(snapshot)

      return {
        snapshot,
        issues: mergeFinalCheckIssues(
          setupIssues,
          mapConfigIssuesToSetupIssues(draft, domainIssues, snapshot),
        ),
      }
    } catch {
      return {
        issues: [
          ...setupIssues,
          {
            severity: 'ERROR',
            code: 'SETUP_COMPILATION_FAILED',
            step: 'FINAL_CHECK',
            message: '設定内容を作成できませんでした。入力内容を確認してください。',
          },
        ],
      }
    }
  }, [draft])

  const goToStep = (step: SetupStep, competitionKey?: string) => {
    setFocusedCompetitionKey(competitionKey)
    updateDraft((nextDraft) => {
      nextDraft.currentStep = step
    })
  }

  const handleNext = () => {
    if (!canGoNext) return
    const nextStep = SETUP_STEPS[activeStep + 1]
    if (!nextStep) return
    goToStep(nextStep.key)
  }

  const handleBack = () => {
    if (!canGoBack) return
    const previousStep = SETUP_STEPS[activeStep - 1]
    if (!previousStep) return
    goToStep(previousStep.key)
  }

  const renderStep = () => {
    switch (draft.currentStep) {
      case 'BASIC':
        return (
          <BasicStep
            name={draft.tournament.name}
            eventDate={draft.tournament.eventDate}
            disabled={controlsDisabled}
            onNameChange={(value) => {
              updateDraft((nextDraft) => {
                nextDraft.tournament.name = value
              })
            }}
            onEventDateChange={(value) => {
              updateDraft((nextDraft) => {
                nextDraft.tournament.eventDate = value || undefined
              })
            }}
          />
        )
      case 'TEAMS':
        return (
          <TeamsStep
            teams={draft.teams}
            disabled={controlsDisabled}
            onTeamCountChange={(count) => {
              updateDraft((nextDraft) => {
                nextDraft.teams = resizeTeams(nextDraft.teams, count)
              })
            }}
            onTeamNameChange={(index, value) => {
              updateDraft((nextDraft) => {
                if (!nextDraft.teams[index]) return
                nextDraft.teams[index] = {
                  ...nextDraft.teams[index],
                  name: value,
                }
              })
            }}
          />
        )
      case 'TEMPLATES':
        return (
          <TemplateStep
            templateSource={draft.templateSource}
            competitions={draft.competitions}
            disabled={controlsDisabled}
            onTemplateChange={(templateSource, competitions) => {
              updateDraft((nextDraft) => {
                nextDraft.templateSource = templateSource
                nextDraft.competitions = competitions
              })
            }}
          />
        )
      case 'COMPETITIONS':
        return (
          <CompetitionStep
            competitions={draft.competitions}
            disabled={controlsDisabled}
            focusedCompetitionKey={focusedCompetitionKey}
            onCompetitionsChange={(competitions) => {
              updateDraft((nextDraft) => {
                nextDraft.competitions = competitions
              })
            }}
          />
        )
      case 'SCHEDULE':
        return (
          <ScheduleStep
            competitions={draft.competitions}
            teams={draft.teams}
            disabled={controlsDisabled}
            focusedCompetitionKey={focusedCompetitionKey}
            onCompetitionsChange={(competitions) => {
              updateDraft((nextDraft) => {
                nextDraft.competitions = competitions
              })
            }}
          />
        )
      case 'SCORING_REVIEW':
        return (
          <ScoringReviewStep
            competitions={draft.competitions}
            issues={finalCheck.issues}
            focusedCompetitionKey={focusedCompetitionKey}
          />
        )
      case 'FINAL_CHECK':
        return (
          <FinalCheckStep
            snapshot={finalCheck.snapshot}
            issues={finalCheck.issues}
            disabled={controlsDisabled}
            onFixIssue={(issue) => goToStep(issue.step, issue.competitionKey)}
            onReadyToApply={(snapshot) => onReadyToApply(snapshot, draft)}
          />
        )
      default:
        return (
          <Alert severity="info" variant="outlined">
            この手順は後続タスクで実装します。
          </Alert>
        )
    }
  }

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
        <div>
          <Typography component="h1" variant="h5">大会セットアップ</Typography>
          <Typography color="text.secondary">
            下書きを自動保存しながら大会構成を順番に入力します。
          </Typography>
        </div>
        <Stack spacing={1} sx={{ alignItems: 'flex-end' }}>
          {!hydrated ? (
            <Typography role="status">読み込み中…</Typography>
          ) : null}
          {saveText ? <Typography role="status">{saveText}</Typography> : null}
          {saveState === 'error' ? (
            <Alert severity="error" role="alert">保存に失敗</Alert>
          ) : null}
        </Stack>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <SetupProgress activeStep={activeStep} />
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          {renderStep()}
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <Button variant="text" onClick={onCancel}>
          キャンセル
        </Button>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={handleBack} disabled={controlsDisabled || !canGoBack}>
            戻る
          </Button>
          <Button variant="contained" onClick={handleNext} disabled={controlsDisabled || !canGoNext}>
            次へ
          </Button>
        </Stack>
      </Box>
    </Stack>
  )
}
