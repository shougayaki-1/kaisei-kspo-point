export interface UpdatePolicyState {
  eventDayPinned: true
  updateAvailable: boolean
  activationApproved: boolean
}

export function createUpdatePolicyState(): UpdatePolicyState {
  return {
    eventDayPinned: true,
    updateAvailable: false,
    activationApproved: false,
  }
}

export function markUpdateAvailable(state: UpdatePolicyState): UpdatePolicyState {
  return {
    ...state,
    updateAvailable: true,
    activationApproved: false,
  }
}

export function approveUpdateActivation(state: UpdatePolicyState): UpdatePolicyState {
  if (!state.updateAvailable) return state
  return {
    ...state,
    activationApproved: true,
  }
}

export function shouldActivateUpdate(state: UpdatePolicyState): boolean {
  return state.updateAvailable && state.activationApproved
}

export function markUpdateActivated(state: UpdatePolicyState): UpdatePolicyState {
  return {
    ...state,
    updateAvailable: false,
    activationApproved: false,
  }
}
