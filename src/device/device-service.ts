import { createId, type DeviceId } from '../domain/ids'

const DEVICE_ID_KEY = 'kaisei-kspo-point.device-id'

export type DeviceStorage = Pick<Storage, 'getItem' | 'setItem'>

export function getOrCreateDeviceId(
  storage: DeviceStorage = window.localStorage,
): DeviceId {
  const existing = storage.getItem(DEVICE_ID_KEY)
  if (existing) {
    return existing as DeviceId
  }

  const deviceId = createId<DeviceId>()
  storage.setItem(DEVICE_ID_KEY, deviceId)
  return deviceId
}
