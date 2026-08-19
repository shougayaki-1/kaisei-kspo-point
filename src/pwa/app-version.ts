// Single runtime source for the operator-visible application build version.
// Keep this value local to the installed artifact; event-day operation must never fetch it remotely.
export const APP_VERSION = '0.1.0' as const
