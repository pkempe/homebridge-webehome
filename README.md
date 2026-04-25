# Homebridge WeBeHome Full

Homebridge WeBeHome Full is a Homebridge dynamic platform plugin for WeBeHome alarm installations. It logs in to the WeBeHome customer APIs, discovers supported alarm devices, and exposes them to Apple Home as HomeKit accessories.

## What It Exposes

- A HomeKit security system accessory for the WeBeHome alarm.
- Contact sensors discovered from WeBeHome sub-unit status data.
- Smoke sensors discovered from WeBeHome sub-unit status data.
- Low-battery status for discovered sensors when WeBeHome reports `LastSignal` as low battery.

Motion sensors are intentionally not exposed at the moment. The source still contains the category and handler scaffolding, but discovery filters them out until the WeBeHome motion `OperationStatus` values are verified.

## Security System Mapping

The plugin maps WeBeHome alarm states to HomeKit security system states:

- `Avlarmat` -> HomeKit disarmed.
- `Larmat i Bortaläge` -> HomeKit away arm.
- `Larmat i Hemmaläge` -> HomeKit stay arm.

HomeKit target state changes call the WeBeHome API actions:

- Disarm -> `disarm`
- Away arm -> `away`
- Stay arm or night arm -> `home`

## Requirements

- Node.js `^20.18.0`, `^22.10.0`, or `^24.0.0`
- Homebridge `^1.8.0` or `^2.0.0-beta.0`
- A WeBeHome account with API access credentials

## Installation

Install dependencies and build the TypeScript output:

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
  "platform": "WeBeHome Full",
  "name": "WeBeHome",
  "login": "your-webehome-username",
  "password": "your-webehome-password"
}
```

The plugin alias must be `WeBeHome Full`; that value is registered in `src/settings.ts` and `config.schema.json`.

## How It Works

On Homebridge startup, the platform waits for `didFinishLaunching`, then:

1. Fetches sub-unit status from `https://webehome.com/API/WebAPI.aspx`.
2. Parses the pipe-delimited WeBeHome response into sensor records.
3. Registers contact and smoke sensors as HomeKit accessories.
4. Fetches detailed alarm status from `https://webehome.com/Public/login.aspx`.
5. Registers or restores the security system accessory.

After startup, the platform refreshes WeBeHome status in the background and pushes changes to HomeKit with `updateCharacteristic`. HomeKit `onGet` handlers return the latest cached value so reads stay fast, while WeBeHome HTTP responses still use a five-second API cache to avoid hammering the endpoints when several values are refreshed together.

Cached Homebridge accessories that no longer appear in a successful startup discovery are removed automatically. Polling can add newly discovered supported sensors without requiring a Homebridge restart.

## Development

Useful commands:

```bash
npm run build
npm run lint
npm test
npm run watch
npm audit --omit=dev
```

The test suite is a lightweight `ts-node` runner under `tests/`. It currently covers WeBeHome response parsing, HomeKit security state mapping, promise-handler error handling, URL encoding, and short-lived API caching.

## Project Layout

- `src/index.ts` registers the Homebridge platform.
- `src/settings.ts` defines the Homebridge platform alias and plugin name.
- `src/WeBeHomePlatform.ts` handles discovery, cached accessory restoration, and platform-level API calls.
- `src/WeBeHomeAPI.ts` wraps the WeBeHome HTTP endpoints and short-lived response cache.
- `src/SensorAccessory.ts` exposes sensor characteristics to HomeKit.
- `src/SecuritySystemAccessory.ts` exposes alarm state and target-state actions to HomeKit.
- `src/WeBeHomeSensor.ts` parses and models WeBeHome sub-unit status rows.
- `config.schema.json` defines the Homebridge UI configuration fields.
- `WBH_Customer_API.pdf` is the local WeBeHome API reference document.

## Publishing Status

This package is currently marked `"private": true` to prevent accidental npm publishing. Remove that flag before publishing a release.
