import assert from 'assert/strict';

import { SecuritySystemAccessory, ServerState } from '../src/SecuritySystemAccessory';
import { ContactSensorState, LowBattery, Sensor, SensorCategory, TitleKey, parseAllDeviceData } from '../src/WeBeHomeSensor';
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

function securitySystemAccessory(platformOverrides = {}) {
  const accessory = Object.create(SecuritySystemAccessory.prototype) as SecuritySystemAccessory;
  Object.defineProperty(accessory, 'platform', {
    value: {
      Characteristic: fakeCharacteristic,
      log: fakeLog(),
      setStateForSecuritySystem: async () => undefined,
      ...platformOverrides,
    },
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

test('Sensor.updateState refreshes state and low-battery fields', () => {
  const sensor = new Sensor(fakeLog() as never, sensorData());

  sensor.updateState(sensorData({
    [TitleKey.LastSignal]: LowBattery.LowBattery,
    [TitleKey.OperationStatus]: ContactSensorState.Open,
  }));

  assert.equal(sensor.getState(), ContactSensorState.Open);
  assert.equal(sensor.hasLowBattery(), true);
});

test('parseSecuritySystemStatus validates and preserves status text', () => {
  assert.deepEqual(parseSecuritySystemStatus('Status:security-uuid:Avlarmat'), {
    uuid: 'security-uuid',
    status: ServerState.Disarmed,
  });
  assert.deepEqual(parseSecuritySystemStatus('Status:security-uuid:Larmat i Hemmaläge:extra'), {
    uuid: 'security-uuid',
    status: 'Larmat i Hemmaläge:extra',
  });
  assert.throws(() => parseSecuritySystemStatus('unexpected'), /Unexpected security system status response/);
});

test('SecuritySystemAccessory maps WeBeHome and HomeKit states', () => {
  const accessory = securitySystemAccessory();

  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.Disarmed), fakeCharacteristic.SecuritySystemCurrentState.DISARMED);
  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.AwayArm), fakeCharacteristic.SecuritySystemCurrentState.AWAY_ARM);
  assert.equal(accessory.mapServerStateToHomebridgeState(ServerState.StayArm), fakeCharacteristic.SecuritySystemCurrentState.STAY_ARM);
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.DISARM), 'disarm');
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.AWAY_ARM), 'away');
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.STAY_ARM), 'home');
  assert.equal(accessory.mapTargetStateToAction(fakeCharacteristic.SecuritySystemTargetState.NIGHT_ARM), 'home');
});

test('SecuritySystemAccessory set handler calls callback once on success and failure', async () => {
  const successfulActions: string[] = [];
  const successAccessory = securitySystemAccessory({
    setStateForSecuritySystem: async (action: string) => {
      successfulActions.push(action);
    },
  });
  const successCallbackErrors: unknown[] = [];

  await successAccessory.handleSecuritySystemStateSet(fakeCharacteristic.SecuritySystemTargetState.DISARM, error => {
    successCallbackErrors.push(error);
  });

  assert.deepEqual(successfulActions, ['disarm']);
  assert.deepEqual(successCallbackErrors, [undefined]);

  const failureAccessory = securitySystemAccessory({
    setStateForSecuritySystem: async () => {
      throw new Error('network down');
    },
  });
  const failureCallbackErrors: unknown[] = [];

  await failureAccessory.handleSecuritySystemStateSet(fakeCharacteristic.SecuritySystemTargetState.AWAY_ARM, error => {
    failureCallbackErrors.push(error);
  });

  assert.equal(failureCallbackErrors.length, 1);
  assert.match((failureCallbackErrors[0] as Error).message, /network down/);
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
  const statusCalls: FetchCall[] = [];
  const statusApi = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
  } as never, fetchClient('Status:alarm-uuid:Avlarmat', statusCalls));

  assert.deepEqual(await statusApi.fetchSecuritySystemStatus(), {
    uuid: 'alarm-uuid',
    status: ServerState.Disarmed,
  });
  assert.match(statusCalls[0].url, /Action=statusdetailed/);
  assert.match(statusCalls[0].url, /ActionOnly=yes/);

  const actionCalls: FetchCall[] = [];
  const actionApi = new WeBeHomeAPI(fakeLog() as never, {
    login: 'login',
    password: 'password',
  } as never, fetchClient('', actionCalls));

  await actionApi.setSecuritySystemTargetState('away');

  assert.equal(actionCalls.length, 1);
  assert.match(actionCalls[0].url, /Action=away/);
  assert.deepEqual(actionCalls[0].options, { method: 'POST' });
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
