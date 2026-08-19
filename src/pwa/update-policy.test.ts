import { describe, expect, it } from 'vitest'
import {
  approveUpdateActivation,
  createUpdatePolicyState,
  markUpdateActivated,
  markUpdateAvailable,
  shouldActivateUpdate,
} from './update-policy'

describe('event-day update policy', () => {
  it('starts pinned and never treats detection as activation approval', () => {
    const initial = createUpdatePolicyState()
    const detected = markUpdateAvailable(initial)

    expect(initial).toEqual({
      eventDayPinned: true,
      updateAvailable: false,
      activationApproved: false,
    })
    expect(detected).toEqual({
      eventDayPinned: true,
      updateAvailable: true,
      activationApproved: false,
    })
    expect(shouldActivateUpdate(detected)).toBe(false)
  })

  it('allows a waiting version to activate only after explicit operator approval', () => {
    const detected = markUpdateAvailable(createUpdatePolicyState())
    const approved = approveUpdateActivation(detected)

    expect(approved.eventDayPinned).toBe(true)
    expect(approved.updateAvailable).toBe(true)
    expect(approved.activationApproved).toBe(true)
    expect(shouldActivateUpdate(approved)).toBe(true)
  })

  it('does not manufacture activation approval when no update is waiting', () => {
    const approved = approveUpdateActivation(createUpdatePolicyState())

    expect(approved.activationApproved).toBe(false)
    expect(shouldActivateUpdate(approved)).toBe(false)
  })

  it('clears one-shot approval after the waiting version is activated', () => {
    const approved = approveUpdateActivation(markUpdateAvailable(createUpdatePolicyState()))
    const activated = markUpdateActivated(approved)

    expect(activated).toEqual({
      eventDayPinned: true,
      updateAvailable: false,
      activationApproved: false,
    })
    expect(shouldActivateUpdate(activated)).toBe(false)
  })
})
