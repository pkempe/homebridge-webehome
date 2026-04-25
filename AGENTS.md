# Agent Notes

## Project

This is a TypeScript Homebridge dynamic platform plugin for WeBeHome alarm systems. The platform registers as `WeBeHome Full` and the package name is `homebridge-webehome-full`.

The plugin currently exposes:

- One HomeKit `SecuritySystem` accessory for the WeBeHome alarm.
- WeBeHome contact sensors as HomeKit `ContactSensor` services.
- WeBeHome smoke sensors as HomeKit `SmokeSensor` services.
- Sensor low-battery status from the WeBeHome `LastSignal` field.

Motion sensors are deliberately filtered out in `src/WeBeHomePlatform.ts` until the WeBeHome motion `OperationStatus` values are confirmed.

## Commands

Use these checks before handing off code changes:

```bash
npm run build
npm run lint
npm test
npm audit --omit=dev
```

The test suite uses `ts-node tests/run-tests.ts` with Node's built-in `assert/strict`. Keep adding focused tests for parsing, state mapping, URL construction, API caching, and HomeKit promise-handler error handling.

## Architecture

- `src/index.ts` registers the platform with Homebridge.
- `src/settings.ts` owns `PLATFORM_NAME` and `PLUGIN_NAME`.
- `src/WeBeHomePlatform.ts` discovers sensors/security system accessories, restores cached Homebridge accessories, polls WeBeHome status, and removes stale cached accessories after successful startup discovery.
- `src/WeBeHomeAPI.ts` calls the WeBeHome HTTP endpoints and caches responses for five seconds.
- `src/SensorAccessory.ts` maps WeBeHome sensor rows to HomeKit sensor characteristics.
- `src/SecuritySystemAccessory.ts` maps WeBeHome alarm state and HomeKit target state actions.
- `src/WeBeHomeSensor.ts` parses the WeBeHome pipe-delimited sensor status response.
- `WBH_Customer_API.pdf` is the local WeBeHome API reference.

## WeBeHome Details

The security system state mapping currently depends on these Swedish WeBeHome status strings:

- `Avlarmat` means disarmed.
- `Larmat i Bortaläge` means armed away.
- `Larmat i Hemmaläge` means armed stay/home.

HomeKit target state actions map to WeBeHome API actions:

- `DISARM` -> `disarm`
- `AWAY_ARM` -> `away`
- `STAY_ARM` and `NIGHT_ARM` -> `home`

Use HomeKit enum values for enum characteristics. Do not return plain booleans for `ContactSensorState` or `SmokeDetected`.

## Coding Guidance

- Keep credential-bearing URLs out of logs.
- Build WeBeHome URLs with `URLSearchParams`; usernames and passwords may contain reserved URL characters.
- HomeKit handlers use Homebridge's promise-style `.onGet()` / `.onSet()` APIs. Keep `.onGet()` fast by returning cached state; do network refreshes in the platform polling path and push updates with `updateCharacteristic`.
- Keep the short-lived API cache behavior in mind when debugging repeated HomeKit reads.
- Do not enable motion sensors until the actual WeBeHome motion status values are verified against real data.
- `dist/` is generated and ignored; do not commit it unless project policy changes.

## Package Notes

The package is still marked `"private": true` to avoid accidental npm publishing. Remove that flag only when preparing an npm release.
