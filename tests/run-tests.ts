/* eslint-disable no-console */
import assert from 'assert/strict';

import { SensorAccessory } from '../src/SensorAccessory';
import { SecuritySystemAccessory, ServerState } from '../src/SecuritySystemAccessory';
import {
  ContactSensorState,
  LowBattery,
  Sensor,
  SensorCategory,
  TitleKey,
  hasParseableDeviceRows,
  parseAllDeviceData,
} from '../src/WeBeHomeSensor';
import { WeBeHomeAPI, parseSecuritySystemStatus } from '../src/WeBeHomeAPI';
import type { FetchClient } from '../src/WeBeHomeAPI';

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

type FetchCall = {
  url: string;
  options?: unknown;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const tests: TestCase[] = [];

function test(name: string, run: TestCase['run']) {
  tests.push({ name, run });
}

function sensorData(overrides: Partial<Record<TitleKey, string>> = {}) {
  return {
    [TitleKey.BUID]: '1',
    [TitleKey.SUID]: '123',
    [TitleKey.DESCR]: 'Front door',
    [TitleKey.SDESCR]: 'Door contact',
    [TitleKey.GNO]: '0',
    [TitleKey.UNO]: '0',
    [TitleKey.GDESCR]: 'Doors',
    [TitleKey.CAT]: SensorCategory.ContactSensor.toString(),
    [TitleKey.CD]: '',
    [TitleKey.LastSignal]: 'Normal',
    [TitleKey.ReadingUpdated]: '2026-04-25 10:00',
    [TitleKey.LastContact]: '2026-04-25 10:01',
    [TitleKey.Devicetype]: 'Contact',
    [TitleKey.Unit]: '',
    [TitleKey.RSSI]: '-60',
    [TitleKey.OperationStatus]: ContactSensorState.Closed,
    [TitleKey.DataValue]: '',
    [TitleKey.Unit1]: '',
    ...overrides,
  };
}

function row(data: Record<TitleKey, string>) {
  return Object.values(TitleKey).map(key => data[key]).join('|');
}

function fakeLog() {
  return {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

const fakeCharacteristic = {
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  Name: 'Name',
  SerialNumber: 'SerialNumber',
  ContactSensorState: {
    CONTACT_DETECTED: 0,
    CONTACT_NOT_DETECTED: 1,
  },
  SecuritySystemCurrentState: {
    STAY_ARM: 0,
    AWAY_ARM: 1,
    NIGHT_ARM: 2,
    DISARMED: 3,
    ALARM_TRIGGERED: 4,
  },
  SecuritySystemTargetState: {
    STAY_ARM: 0,
    AWAY_ARM: 1,
    NIGHT_ARM: 2,
    DISARM: 3,
  },
  SmokeDetected: {
    SMOKE_NOT_DETECTED: 0,
    SMOKE_DETECTED: 1,
  },
  StatusLowBattery: {
    BATTERY_LEVEL_NORMAL: 0,
    BATTERY_LEVEL_LOW: 1,
  },
};

class FakeService {
  public readonly updates: Array<{ characteristic: unknown; value: unknown }> = [];
  private readonly getHandlers = new Map<unknown, () => unknown>();

  constructor(
    public readonly name?: string,
    public readonly subtype?: string,
  ) {
  }

  setCharacteristic(characteristic: unknown, value: unknown): this {
    this.updates.push({ characteristic, value });
    return this;
  }

  updateCharacteristic(characteristic: unknown, value: unknown): this {
    this.updates.push({ characteristic, value });
    return this;
  }

  getCharacteristic(characteristic: unknown) {
    const characteristicApi = {
      onGet: (handler: () => unknown) => {
        this.getHandlers.set(characteristic, handler);
        return characteristicApi;
      },
    };

    return characteristicApi;
  }
}

class FakeAccessoryInformationService extends FakeService {}
class FakeContactSensorService extends FakeService {}
class FakeSmokeSensorService extends FakeService {}

function sensorPlatform() {
  const accessoryInformation = new FakeAccessoryInformationService();
  const services: FakeService[] = [];
  const requestedRefreshes: number[] = [];
  const accessory = {
    context: {},
    addService: (service: FakeService) => {
      services.push(service);
    },
    getService: (serviceType: unknown) => {
      if (serviceType === FakeAccessoryInformationService) {
        return accessoryInformation;
      }
      return undefined;
    },
  };
  const platform = {
    Characteristic: fakeCharacteristic,
    Service: {
      AccessoryInformation: FakeAccessoryInformationService,
      ContactSensor: FakeContactSensorService,
      SmokeSensor: FakeSmokeSensorService,
    },
    log: fakeLog(),
    requestSensorRefresh: (suid: number) => {
      requestedRefreshes.push(suid);
      return Promise.resolve();
    },
  };

  return {
    accessory,
    platform,
    requestedRefreshes,
    services,
  };
}

function securitySystemAccessory(platformOverrides = {}) {
  class FakeHapStatusError extends Error {
    constructor(public readonly status: number) {
      super(`HAP status ${status}`);
    }
  }

  const accessory = Object.create(SecuritySystemAccessory.prototype) as SecuritySystemAccessory;
  Object.defineProperty(accessory, 'platform', {
    value: {
      Characteristic: fakeCharacteristic,
      api: {
        hap: {
          HAPStatus: {
            SERVICE_COMMUNICATION_FAILURE: -70402,
          },
          HapStatusError: FakeHapStatusError,
        },
      },
      log: fakeLog(),
      refreshSecuritySystem: async () => undefined,
      requestSecuritySystemRefresh: async () => undefined,
      setStateForSecuritySystem: async () => undefined,
      ...platformOverrides,
    },
  });
  Object.defineProperty(accessory, 'service', {
    value: {
      updateCharacteristic: () => undefined,
    },
  });
  Object.defineProperty(accessory, 'statusDict', {
    value: {
      uuid: 'alarm-uuid',
      status: ServerState.Disarmed,
    },
    writable: true,
  });

  return accessory;
}

function fetchClient(responseText: string, calls: FetchCall[] = [], ok = true) {
  const client = (async (url: string, options?: unknown) => {
    calls.push({ url, options });
    return {
      ok,
      status: ok ? 200 : 500,
      text: async () => responseText,
    };
  }) as FetchClient;

  return client;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve;
  });

  return {
    promise,
    resolve,
  };
}

function fetchMethod(options: unknown): string | undefined {
  return (options as { method?: string } | undefined)?.method;
}

test('parseAllDeviceData maps WeBeHome rows by title key', () => {
  const data = sensorData({
    [TitleKey.SUID]: '456',
    [TitleKey.DESCR]: 'Kitchen smoke',
    [TitleKey.CAT]: SensorCategory.SmokeDetector.toString(),
  });
  const parsed = parseAllDeviceData(`headers</br>${row(data)}`);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0][TitleKey.SUID], '456');
  assert.equal(parsed[0][TitleKey.DESCR], 'Kitchen smoke');
  assert.equal(parsed[0][TitleKey.CAT], '300');
});

test('hasParseableDeviceRows rejects malformed responses before stale cleanup', () => {
  assert.equal(hasParseableDeviceRows(parseAllDeviceData('login failed')), false);
  assert.equal(hasParseableDeviceRows(parseAllDeviceData('headers</br>')), false);
  assert.equal(hasParseableDeviceRows(parseAllDeviceData(`headers</br>${row(sensorData({
    [TitleKey.CAT]: SensorCategory.Keypad.toString(),
  }))}`)), true);
});

test('Sensor.updateState refreshes state and low-battery fields', () => {
  const sensor = new Sensor(fakeLog() as never, sensorData());

  sensor.updateState(sensorData({
    [TitleKey.LastSignal]: LowBattery.LowBattery,
    [TitleKey.OperationStatus]: ContactSensorState.Open,
  }));

  assert.equal(sensor.getState(), ContactSensorState.Open);
  assert.equal(sensor.hasLowBattery(), true);
});

test('SensorAccessory returns cached contact and battery states', () => {
  const { accessory, platform, requestedRefreshes, services } = sensorPlatform();
  const sensor = new Sensor(fakeLog() as never, sensorData());
  const sensorAccessory = new SensorAccessory(platform as never, accessory as never, sensor);

  assert.equal(services.length, 1);
  assert.equal(sensorAccessory.handleContactSensorStateGet(), fakeCharacteristic.ContactSensorState.CONTACT_DETECTED);
  assert.equal(sensorAccessory.handleStatusLowBatteryGet(), fakeCharacteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  assert.deepEqual(requestedRefreshes, [123, 123]);

  sensorAccessory.updateSensor(sensorData({
    [TitleKey.LastSignal]: LowBattery.LowBattery,
    [TitleKey.OperationStatus]: ContactSensorState.Open,
  }));

  assert.equal(sensorAccessory.handleContactSensorStateGet(), fakeCharacteristic.ContactSensorState.CONTACT_NOT_DETECTED);
  assert.equal(sensorAccessory.handleStatusLowBatteryGet(), fakeCharacteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
  assert.deepEqual(services[0].updates.slice(-2), [
    {
      characteristic: fakeCharacteristic.StatusLowBattery,
      value: fakeCharacteristic.StatusLowBattery.BATTERY_LEVEL_LOW,
    },
    {
      characteristic: fakeCharacteristic.ContactSensorState,
      value: fakeCharacteristic.ContactSensorState.CONTACT_NOT_DETECTED,
    },
  ]);
});

test('parseSecuritySystemStatus validates and extracts status text', () => {
  assert.deepEqual(parseSecuritySystemStatus('Status:security-uuid:Avlarmat'), {
    uuid: 'security-uuid',
    status: ServerState.Disarmed,
  });
  assert.deepEqual(parseSecuritySystemStatus('Status:security-uuid:Larmat i Hemmaläge:Example User (Internet):07:00:155'), {
    uuid: 'security-uuid',
    status: ServerState.NightArm,
  });
  assert.throws(() => parseSecuritySystemStatus('unexpected'), /Unexpected security system status response/);
});

test('SecuritySystemAccessory maps WeBeHome and HomeKit states', () => {
  const accessory = securitySystemAccessory();

  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.Disarmed), fakeCharacteristic.SecuritySystemCurrentState.DISARMED);
  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.LiteralDisarmed),
    fakeCharacteristic.SecuritySystemCurrentState.DISARMED);
  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.AwayArm), fakeCharacteristic.SecuritySystemCurrentState.AWAY_ARM);
  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.NightArm), fakeCharacteristic.SecuritySystemCurrentState.NIGHT_ARM);
  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.AlarmTriggered),
    fakeCharacteristic.SecuritySystemCurrentState.ALARM_TRIGGERED);
  assert.equal(accessory.mapServerStateToHomebridgeTargetState(ServerState.Disarmed), fakeCharacteristic.SecuritySystemTargetState.DISARM);
  assert.equal(accessory.mapServerStateToHomebridgeTargetState(ServerState.LiteralDisarmed),
    fakeCharacteristic.SecuritySystemTargetState.DISARM);
  assert.equal(accessory.mapServerStateToHomebridgeTargetState(ServerState.NightArm),
    fakeCharacteristic.SecuritySystemTargetState.NIGHT_ARM);
  assert.equal(accessory.mapServerStateToHomebridgeTargetState(ServerState.AlarmTriggered),
    fakeCharacteristic.SecuritySystemTargetState.NIGHT_ARM);
  assert.equal(accessory.mapServerStateToHomebridgeTargetState(ServerState.AwayArm), fakeCharacteristic.SecuritySystemTargetState.AWAY_ARM);
  assert.equal(accessory.mapServerStateToHomebridgeTargetState(ServerState.AlarmTriggered),
    fakeCharacteristic.SecuritySystemTargetState.AWAY_ARM);
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.DISARM), 'disarm');
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.AWAY_ARM), 'away');
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.STAY_ARM), 'home');
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.NIGHT_ARM), 'home');
});

test('SecuritySystemAccessory get handlers request a fresh status refresh', () => {
  let refreshRequests = 0;
  const accessory = securitySystemAccessory({
    requestSecuritySystemRefresh: async () => {
      refreshRequests++;
    },
  });

  assert.equal(accessory.handleSecuritySystemStateGet(), fakeCharacteristic.SecuritySystemCurrentState.DISARMED);
  assert.equal(accessory.handleSecuritySystemTargetStateGet(), fakeCharacteristic.SecuritySystemTargetState.DISARM);
  assert.equal(refreshRequests, 2);
});

test('SecuritySystemAccessory set handler resolves on success and rejects on failure', async () => {
  const successfulActions: string[] = [];
  let refreshCount = 0;
  const successAccessory = securitySystemAccessory({
    refreshSecuritySystem: async () => {
      refreshCount++;
    },
    setStateForSecuritySystem: async (action: string) => {
      successfulActions.push(action);
    },
  });

  await successAccessory.handleSecuritySystemStateSet(fakeCharacteristic.SecuritySystemTargetState.DISARM);

  assert.deepEqual(successfulActions, ['disarm']);
  assert.equal(refreshCount, 1);

  const failureAccessory = securitySystemAccessory({
    setStateForSecuritySystem: async () => {
      throw new Error('network down');
    },
  });

  await assert.rejects(
    () => failureAccessory.handleSecuritySystemStateSet(fakeCharacteristic.SecuritySystemTargetState.AWAY_ARM),
    /HAP status -70402/,
  );
});

test('WeBeHomeAPI encodes credentials and caches sensor status fetches', async () => {
  const calls: FetchCall[] = [];
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'user+name@example.com',
    password: 'pa&ss=word',
  } as never, fetchClient('headers</br>', calls));

  await api.fetchStatus();
  await api.fetchStatus();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /LoginName=user%2Bname%40example\.com/);
  assert.match(calls[0].url, /Password=pa%26ss%3Dword/);
  assert.match(calls[0].url, /Function=GetSubUnitStatus/);
});

test('WeBeHomeAPI fetches security status and posts target actions', async () => {
  const calls: FetchCall[] = [];
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
  } as never, fetchClient('Status:alarm-uuid:Avlarmat', calls));

  assert.deepEqual(await api.fetchSecuritySystemStatus(), {
    uuid: 'alarm-uuid',
    status: ServerState.Disarmed,
  });
  assert.match(calls[0].url, /Action=statusdetailed/);
  assert.match(calls[0].url, /ActionOnly=yes/);

  await api.setSecuritySystemTargetState('away');
  await api.fetchSecuritySystemStatus();

  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /Action=away/);
  assert.equal(fetchMethod(calls[1].options), 'POST');
  assert.match(calls[2].url, /Action=statusdetailed/);
});

test('WeBeHomeAPI coalesces concurrent security status fetches', async () => {
  const calls: FetchCall[] = [];
  const unblock = deferred<void>();
  const client = (async (url: string, options?: unknown) => {
    calls.push({ url, options });
    await unblock.promise;
    return {
      ok: true,
      status: 200,
      text: async () => 'Status:alarm-uuid:Avlarmat',
    };
  }) as FetchClient;
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
  } as never, client);

  const first = api.fetchSecuritySystemStatus(true);
  const second = api.fetchSecuritySystemStatus(true);

  assert.equal(calls.length, 1);
  unblock.resolve();
  assert.deepEqual(await Promise.all([first, second]), [
    {
      uuid: 'alarm-uuid',
      status: ServerState.Disarmed,
    },
    {
      uuid: 'alarm-uuid',
      status: ServerState.Disarmed,
    },
  ]);
});

test('WeBeHomeAPI backs off after repeated request failures', async () => {
  const calls: FetchCall[] = [];
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
  } as never, fetchClient('', calls, false));

  await assert.rejects(() => api.fetchStatus(true), /HTTP error/);
  await assert.rejects(() => api.fetchStatus(true), /HTTP error/);
  await assert.rejects(() => api.fetchStatus(true), /backoff/);

  assert.equal(calls.length, 2);
});

test('WeBeHomeAPI security status backoff does not block target actions', async () => {
  const calls: FetchCall[] = [];
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
  } as never, (async (url: string, options?: unknown) => {
    calls.push({ url, options });
    const isAction = url.includes('Action=away');
    return {
      ok: isAction,
      status: isAction ? 200 : 500,
      text: async () => '',
    };
  }) as FetchClient);

  await assert.rejects(() => api.fetchSecuritySystemStatus(true), /HTTP error/);
  await assert.rejects(() => api.fetchSecuritySystemStatus(true), /HTTP error/);
  await api.setSecuritySystemTargetState('away');

  assert.equal(calls.length, 3);
  assert.equal(fetchMethod(calls[2].options), 'POST');
});

test('WeBeHomeAPI does not back off repeated security target actions', async () => {
  const calls: FetchCall[] = [];
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
  } as never, fetchClient('', calls, false));

  await assert.rejects(() => api.setSecuritySystemTargetState('away'), /HTTP error/);
  await assert.rejects(() => api.setSecuritySystemTargetState('away'), /HTTP error/);
  await assert.rejects(() => api.setSecuritySystemTargetState('away'), /HTTP error/);

  assert.equal(calls.length, 3);
});

test('WeBeHomeAPI sanitizes credential-bearing request errors', async () => {
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login@example.com',
    password: 'secret-password',
  } as never, ((url: string) => Promise.reject(new Error(`failed ${url}`))) as FetchClient);

  await assert.rejects(
    () => api.fetchStatus(true),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message.includes('login@example.com'), false);
      assert.equal(error.message.includes('secret-password'), false);
      assert.match(error.message, /WeBeHome sensor request failed/);
      return true;
    },
  );
});

test('WeBeHomeAPI aborts slow requests after the configured timeout', async () => {
  const api = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
    requestTimeoutMs: 1,
  } as never, ((url: string, options?: unknown) => new Promise((_resolve, reject) => {
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
    signal?.addEventListener('abort', () => reject(new Error(`aborted ${url}`)));
  })) as FetchClient);

  await assert.rejects(() => api.fetchStatus(true), /timed out after 1000ms/);
});

async function run() {
  let passed = 0;

  for (const item of tests) {
    try {
      await item.run();
      passed++;
      console.log(`ok - ${item.name}`);
    } catch (error) {
      console.error(`not ok - ${item.name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }

  console.log(`${passed}/${tests.length} tests passed`);
}

run();
