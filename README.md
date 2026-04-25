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

- Node.js `>=14.18.1`
- Homebridge `>=1.3.5`
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

Sensor and security status requests are cached for five seconds to avoid hammering the WeBeHome endpoints when HomeKit asks several characteristics in quick succession.

## Development

Useful commands:

```bash
npm run build
npm run lint
npm run watch
npm audit --omit=dev
```

There is currently no `npm test` script. For behavior changes, add focused coverage around parsing, HomeKit state mapping, and callback error paths before relying on manual Homebridge testing alone.

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

This package is currently marked `"private": true` and still has placeholder repository metadata in `package.json`. Update the metadata and remove `private` before publishing to npm.
