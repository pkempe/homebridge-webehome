# Homebridge WeBeHome

Homebridge WeBeHome is a Homebridge dynamic platform plugin for WeBeHome alarm installations. It logs in to the WeBeHome customer APIs, discovers supported alarm devices, and exposes them to Apple Home as HomeKit accessories.

## What Is WeBeHome?

[WeBeHome](https://www.webehome.com/) is a Swedish cloud-based alarm and smart-home service from WeBeHome AB. A WeBeHome installation can include an alarm base unit, wireless sensors, cameras, switches, meters, and other smart-home devices. The base unit stays connected to WeBeHome's cloud service, where events, readings, and camera data can be monitored and controlled from mobile apps or a web browser.

This plugin is not affiliated with WeBeHome AB. It integrates with the customer-facing WeBeHome APIs so existing WeBeHome alarm and sensor data can be exposed to HomeKit through Homebridge.

## What It Exposes

- A HomeKit security system accessory for the WeBeHome alarm.
- Contact sensors discovered from WeBeHome sub-unit status data.
- Smoke sensors discovered from WeBeHome sub-unit status data.
- Low-battery status for discovered sensors when WeBeHome reports `LastSignal` as low battery.

Motion sensors are intentionally not implemented at the moment. The parser still knows the WeBeHome motion category, but discovery filters motion devices out until the WeBeHome motion `OperationStatus` values are verified.

## Security System Mapping

The plugin maps WeBeHome alarm states to HomeKit security system states:

- `Avlarmat` -> HomeKit disarmed.
- `Larmat i Bortaläge` -> HomeKit away arm.
- `Larmat i Hemmaläge` -> HomeKit night arm.
- `Disarmed` -> HomeKit disarmed, matching `Avlarmat`.
- `AlarmTriggered` -> HomeKit current-state alarm triggered.

HomeKit `STAY_ARM` means the system is armed while people are home. It is not the same as disarmed. WeBeHome does not currently report a separate stay state; selecting either HomeKit stay arm or night arm sends WeBeHome's `home` action, and WeBeHome reports that mode back as `Larmat i Hemmaläge` / HomeKit night arm. HomeKit has no alarm-triggered target state, so while the alarm is triggered the plugin keeps reporting the last known armed target state. It does not send a disarm command unless HomeKit explicitly sets the target state to disarm.

HomeKit target state changes call the WeBeHome API actions:

- Disarm -> `disarm`
- Away arm -> `away`
- Stay arm or night arm -> `home`

## Requirements

- Node.js `^20.18.0`, `^22.10.0`, or `^24.0.0`
- Homebridge `^1.8.0` or `^2.0.0-beta.0`
- A WeBeHome account with API access credentials

## Installation

Install the plugin through Homebridge UI, or with npm:

```bash
sudo npm install -g homebridge-webehome
```

For local development, install dependencies and build the TypeScript output:

```bash
npm install
npm run build
```

For local Homebridge development, link the plugin:

```bash
npm link
```

Then restart Homebridge so it can load `dist/index.js`.

## Configuration

Add the platform to the Homebridge `platforms` array:

```json
{
  "platform": "WeBeHome",
  "name": "WeBeHome",
  "login": "your-webehome-username",
  "password": "your-webehome-password",
  "requestTimeoutMs": 15000
}
```

The plugin alias must be `WeBeHome`; that value is registered in `src/settings.ts` and `config.schema.json`.
`requestTimeoutMs` is optional and defaults to 15000.

If you used the unpublished pre-release build, update the old platform value `WeBeHome Full` to `WeBeHome` when moving to the public package.

## How It Works

On Homebridge startup, the platform waits for `didFinishLaunching`, then:

1. Fetches sub-unit status from `https://webehome.com/API/WebAPI.aspx`.
2. Parses the pipe-delimited WeBeHome response into sensor records.
3. Registers contact and smoke sensors as HomeKit accessories.
4. Fetches detailed alarm status from `https://webehome.com/Public/login.aspx`.
5. Registers or restores the security system accessory.

After startup, the platform refreshes known WeBeHome accessories in the background and pushes changes to HomeKit with `updateCharacteristic`. A slower rediscovery pass can add newly supported sensors or remove stale cached accessories without requiring a Homebridge restart.

HomeKit `onGet` handlers return the latest cached value so reads stay fast, and also request a fresh WeBeHome refresh in the background when the accessory is opened. These on-access refreshes are coalesced and lightly throttled so HomeKit reading several characteristics does not create a burst of duplicate calls.

WeBeHome HTTP requests have a timeout and short failure backoff. Sensor status and security status requests are also coalesced while an identical fetch is already in flight.

The WeBeHome API docs are available from [webehome.com/sv/docs](https://webehome.com/sv/docs). They document `LoginName` and `Password` as URL parameters for both the browser-style Web API and the login/action URLs. The plugin follows that documented interface and avoids logging or rethrowing credential-bearing URLs.

The parsed API reference lives in `docs/wbh-customer-api.v1.16.json` so code and tests can inspect the documented endpoints without storing the full source document in this repository.

## Development

Useful commands:

```bash
npm run build
npm run lint
npm test
npm run watch
npm audit --omit=dev
```

The test suite is a lightweight `ts-node` runner under `tests/`. It currently covers WeBeHome response parsing, HomeKit security state mapping, promise-handler error handling, URL encoding, sanitized request errors, short-lived API caching, request coalescing, timeout aborts, and failure backoff.

## Project Layout

- `src/index.ts` registers the Homebridge platform.
- `src/settings.ts` defines the Homebridge platform alias and plugin name.
- `src/WeBeHomePlatform.ts` handles discovery, cached accessory restoration, background refresh, and platform-level API calls.
- `src/WeBeHomeAPI.ts` wraps the WeBeHome HTTP endpoints, short-lived response cache, request timeout, coalescing, and failure backoff.
- `src/SensorAccessory.ts` exposes sensor characteristics to HomeKit.
- `src/SecuritySystemAccessory.ts` exposes alarm state and target-state actions to HomeKit.
- `src/WeBeHomeSensor.ts` parses and models WeBeHome sub-unit status rows.
- `config.schema.json` defines the Homebridge UI configuration fields.
- `docs/wbh-customer-api.v1.16.json` is the machine-readable WeBeHome Customer API reference.

## Publishing Status

The npm package is prepared as `homebridge-webehome` version `1.0.0`.
