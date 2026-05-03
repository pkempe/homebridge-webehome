import type { Logger } from 'homebridge';

export enum TitleKey {
	BUID = 'BUID',
	SUID = 'SUID',
	DESCR = 'DESCR',
	SDESCR = 'SDESCR',
	GNO = 'GNO',
	UNO = 'UNO',
	GDESCR = 'GDESCR',
	CAT = 'CAT',
	CD = 'CD',
	LastSignal = 'LastSignal',
	ReadingUpdated = 'ReadingUpdated',
	LastContact = 'LastContact',
	Devicetype = 'Devicetype',
	Unit = 'Unit',
	RSSI = 'RSSI',
	OperationStatus = 'OperationStatus',
	DataValue = 'DataValue',
	Unit1 = 'Unit1'
  }

export enum ContactSensorState {
  Open = '64',
  Closed = '72'
}

export enum SmokeDetectionState {
  NotDetected = '88'
}

export enum SensorCategory {
	ContactSensor = 2,
	Keypad = 99,
	SmokeDetector = 300,
	MotionDetector = 7,
}

export enum LowBattery {
	LowBattery = 'Låg batterinivå'
}

export type SensorData = { [key in TitleKey]?: string };

export function sensorIdentityKey(buid: number, suid: number): string {
  return `${buid}:${suid}`;
}

export function sensorIdentityKeyFromData(deviceData: SensorData): string | undefined {
  const buid = parsePositiveIntegerString(deviceData[TitleKey.BUID]);
  const suid = parsePositiveIntegerString(deviceData[TitleKey.SUID]);

  if (buid === undefined || suid === undefined) {
    return undefined;
  }

  return sensorIdentityKey(buid, suid);
}

export class Sensor {
  buid: number;
  suid: number;
  readingUpdated: string;
  description: string;
  sensorDescription: string;
  lastContact: string;
  lastSignal: string;
  deviceCategory: string;
  deviceType: string;
  operationStatus: string;
  manufacturer: string;
  model: string;
  name: string;
  log: Logger;
  state: string;

  constructor(log: Logger, deviceData: SensorData | undefined) {
    this.log = log;
    // this.log.debug('--- Constructing sensor ---');
    if (!deviceData) {
      throw new Error('Insufficient data to create device');
    }

    this.buid = parseInt(deviceData[TitleKey.BUID] || '0');
    this.suid = parseInt(deviceData[TitleKey.SUID] || '0');
    this.description = deviceData[TitleKey.DESCR] || '';
    this.sensorDescription = deviceData[TitleKey.SDESCR] || '';
    this.readingUpdated = deviceData[TitleKey.ReadingUpdated] || '';
    this.lastContact = deviceData[TitleKey.LastContact] || '';
    this.lastSignal = deviceData[TitleKey.LastSignal] || '';
    this.deviceCategory = deviceData[TitleKey.CAT] || '';
    this.deviceType = deviceData[TitleKey.Devicetype] || '';
    this.operationStatus = deviceData[TitleKey.OperationStatus] || '';
    this.manufacturer = 'WeBeHome';
    this.model = this.sensorDescription;
    this.name = this.description;

    this.state = deviceData[TitleKey.OperationStatus] || '';
    // this.printDescription();
  }

  public printDescription(): void {
    Object.keys(this).forEach((key) => {
      this.log.debug(`${key}: ${this[key as keyof Sensor]}`);
    });
  }

  updateState(deviceData: SensorData) {
    if (!deviceData) {
      throw new Error('Insufficient data to update state');
    }

    this.buid = parseInt(deviceData[TitleKey.BUID] || '0');
    this.suid = parseInt(deviceData[TitleKey.SUID] || '0');
    this.description = deviceData[TitleKey.DESCR] || '';
    this.sensorDescription = deviceData[TitleKey.SDESCR] || '';
    this.readingUpdated = deviceData[TitleKey.ReadingUpdated] || '';
    this.lastContact = deviceData[TitleKey.LastContact] || '';
    this.lastSignal = deviceData[TitleKey.LastSignal] || '';
    this.deviceCategory = deviceData[TitleKey.CAT] || '';
    this.deviceType = deviceData[TitleKey.Devicetype] || '';
    this.operationStatus = deviceData[TitleKey.OperationStatus] || '';
    this.model = this.sensorDescription;
    this.name = this.description;
    this.state = deviceData[TitleKey.OperationStatus] || '';
  }

  // Add a `getState()` method
  getState(): string {
    return this.state;
  }

  hasLowBattery(): boolean {
    return this.lastSignal === LowBattery.LowBattery;
  }

  get identityKey(): string {
    return sensorIdentityKey(this.buid, this.suid);
  }

}

export function parseAllDeviceData(allDeviceData: string): SensorData[] {
  // Split the full data string into rows
  const rows = allDeviceData.split('</br>');

  // Skip the first entry (the headers) using slice, then map over the rows and parse each one into an object
  const parsedRows = rows.slice(1).map(row => {
    const values = row.split('|');
    const parsedData: { [key in TitleKey]?: string } = {};

    // Loop over each title in the enum, and add an entry to the object for each one
    let i = 0;
    for (const key in TitleKey) {
      parsedData[key as TitleKey] = values[i++];
    }

    return parsedData;
  });

  return parsedRows;
}

export function hasParseableDeviceRows(deviceDataArray: SensorData[]): boolean {
  return deviceDataArray.some(deviceData =>
    isPositiveIntegerString(deviceData[TitleKey.BUID]) &&
    isPositiveIntegerString(deviceData[TitleKey.SUID]) &&
    isPositiveIntegerString(deviceData[TitleKey.CAT]),
  );
}

function parsePositiveIntegerString(value: string | undefined): number | undefined {
  if (value === undefined || !isPositiveIntegerString(value)) {
    return undefined;
  }

  return Number.parseInt(value, 10);
}

function isPositiveIntegerString(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0;
}
