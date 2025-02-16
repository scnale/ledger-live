import { DeviceId, DeviceInfo } from "@ledgerhq/types-live";
import { concat, Observable, of } from "rxjs";
import { scan, switchMap } from "rxjs/operators";
import {
  updateFirmwareTask,
  UpdateFirmwareTaskEvent,
} from "../tasks/updateFirmware";
import {
  getDeviceInfoTask,
  GetDeviceInfoTaskErrorEvent,
} from "../tasks/getDeviceInfo";
import {
  FullActionState,
  initialSharedActionState,
  sharedReducer,
} from "./core";
import {
  getLatestFirmwareTask,
  GetLatestFirmwareTaskErrorEvent,
} from "../tasks/getLatestFirmware";

export type updateFirmwareActionArgs = {
  deviceId: DeviceId;
};

export type UpdateFirmwareActionState = FullActionState<{
  step:
    | "preparingUpdate"
    // initial step where we retrieve all the necessary information for the update
    | "allowSecureChannelRequested"
    // we need a secure connection to the HSM to install the operating system updater (osu)
    | "installingOsu"
    // step that installs the operating system updater, always happen
    | "installOsuDevicePermissionRequested"
    // permission requested for istalling the osu
    | "installOsuDevicePermissionGranted"
    // the user has confirmed the firmware installation on the device
    | "installOsuDevicePermissionDenied"
    // the user has refused the firmware installation on the device
    | "flashingMcu"
    // step that flashes the mcu of the device, only happens when necessary
    | "flashingBootloader"
    // step that flashes the bootloader of the device, only happen when necessary
    | "firmwareUpdateCompleted";
  // final step when the device has reconnected after the firwmare update has been completed

  progress: number;
  updatedDeviceInfo?: DeviceInfo;
  error: { type: "UpdateFirmwareError"; name: string };
}>;

export const initialState: UpdateFirmwareActionState = {
  step: "preparingUpdate",
  progress: 0,
  ...initialSharedActionState,
};

/**
 * Device Action used to update the firmware installed on a Ledger device
 * @param deviceId the transport id of the device to be updated
 * @returns an Observables that emits the evolution of the state machine of the firmware installation
 */
export function updateFirmwareAction({
  deviceId,
}: updateFirmwareActionArgs): Observable<UpdateFirmwareActionState> {
  return concat(
    of(initialState),
    getDeviceInfoTask({ deviceId }).pipe(
      switchMap((event) => {
        if (event.type !== "data") {
          return of(event);
        }
        const { deviceInfo } = event;
        return getLatestFirmwareTask({ deviceId, deviceInfo });
      }),
      switchMap((event) => {
        if (event.type !== "data") {
          return of(event);
        } else {
          return updateFirmwareTask({
            deviceId,
            updateContext: event.firmwareUpdateContext,
          });
        }
      }),
      scan<
        | UpdateFirmwareTaskEvent
        | GetLatestFirmwareTaskErrorEvent
        | GetDeviceInfoTaskErrorEvent,
        UpdateFirmwareActionState
      >((_, event) => {
        switch (event.type) {
          case "taskError":
            return {
              ...initialState,
              error: {
                type: "UpdateFirmwareError",
                name: event.error,
              },
            };
          case "installingOsu":
          case "flashingMcu":
          case "flashingBootloader":
            return {
              ...initialState,
              step: event.type,
              progress: event.progress,
            };
          case "allowSecureChannelRequested":
          case "installOsuDevicePermissionRequested":
          case "installOsuDevicePermissionGranted":
          case "installOsuDevicePermissionDenied":
            return { ...initialState, step: event.type };
          case "firmwareUpdateCompleted":
            return {
              ...initialState,
              step: event.type,
              updatedDeviceInfo: event.updatedDeviceInfo,
            };
          default:
            return {
              ...initialState,
              ...sharedReducer({
                event,
              }),
            };
        }
      }, initialState)
    )
  );
}
