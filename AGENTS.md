# Agent Notes

## Project

This is a TypeScript Homebridge dynamic platform plugin for WeBeHome alarm systems. The platform registers as `WeBeHome` and the package name is `homebridge-webehome`.

The plugin currently exposes:

- One HomeKit `SecuritySystem` accessory for the WeBeHome alarm.
- WeBeHome contact sensors as HomeKit `ContactSensor` services.
- WeBeHome smoke sensors as HomeKit `SmokeSensor` services.
- Sensor low-battery status from the WeBeHome `LastSignal` field.

Motion sensors are deliberately not implemented. `src/WeBeHomeSensor.ts` still defines the WeBeHome motion category for parsing clarity, but `src/WeBeHomePlatform.ts` filters motion devices out until the WeBeHome motion `OperationStatus` values are confirmed.

## Commands

Use these checks before handing off code changes:

```bash
npm run build
npm run lint
npm test
npm audit --omit=dev
```

The test suite uses `ts-node tests/run-tests.ts` with Node's built-in `assert/strict`. Keep adding focused tests for parsing, state mapping, URL construction, sanitized request errors, API caching, request coalescing, timeout/backoff behavior, and HomeKit promise-handler error handling.

## Architecture

- `src/index.ts` registers the platform with Homebridge.
- `src/settings.ts` owns `PLATFORM_NAME` and `PLUGIN_NAME`.
- `src/WeBeHomePlatform.ts` discovers sensors/security system accessories, restores cached Homebridge accessories, refreshes known accessories, runs periodic rediscovery, and removes stale cached accessories after successful discovery.
- `src/WeBeHomeAPI.ts` calls the WeBeHome HTTP endpoints, caches responses for five seconds, coalesces in-flight requests, and applies timeout/backoff behavior.
- `src/SensorAccessory.ts` maps WeBeHome sensor rows to HomeKit sensor characteristics.
- `src/SecuritySystemAccessory.ts` maps WeBeHome alarm state and HomeKit target state actions.
- `src/WeBeHomeSensor.ts` parses the WeBeHome pipe-delimited sensor status response.
- `docs/wbh-customer-api.v1.16.json` is the machine-readable WeBeHome Customer API reference. Prefer it over scraping the public docs during normal coding work.
- The public WeBeHome API documentation is available at https://webehome.com/sv/docs.

## WeBeHome Details

The security system state mapping currently depends on these Swedish WeBeHome status strings:

- `Avlarmat` maps to HomeKit disarmed.
- `Larmat i Bortaläge` maps to HomeKit away arm.
- `Larmat i Hemmaläge` maps to HomeKit night arm.
- Literal `Disarmed` maps the same as `Avlarmat`.
- `AlarmTriggered` maps to HomeKit current-state alarm triggered; there is no HomeKit alarm-triggered target state, so preserve the last known armed target state.

HomeKit target state actions map to WeBeHome API actions:

- `DISARM` -> `disarm`
- `AWAY_ARM` -> `away`
- `STAY_ARM` and `NIGHT_ARM` -> `home`

Use HomeKit enum values for enum characteristics. Do not return plain booleans for `ContactSensorState` or `SmokeDetected`.

## Coding Guidance

- Keep credential-bearing URLs out of logs.
- Build WeBeHome URLs with `URLSearchParams`; usernames and passwords may contain reserved URL characters. The API reference documents `LoginName` and `Password` as URL parameters, so sanitize request errors instead of rethrowing credential-bearing URLs.
- HomeKit handlers use Homebridge's promise-style `.onGet()` / `.onSet()` APIs. Keep `.onGet()` fast by returning cached state, but request an on-access refresh so opening an accessory still attempts to pull fresh WeBeHome state.
- Keep the short-lived API cache, on-access refresh cooldown, in-flight coalescing, and timeout/backoff behavior in mind when debugging repeated HomeKit reads.
- Do not enable motion sensors until the actual WeBeHome motion status values are verified against real data.
- `dist/` is generated and ignored; do not commit it unless project policy changes.

## Package Notes

The package is prepared for public npm publishing as `homebridge-webehome`.
