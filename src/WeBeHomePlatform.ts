import type { API, DynamicPlatformPlugin, Logger,
  PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SensorAccessory } from './SensorAccessory';
import { SecuritySystemData, WeBeHomeAPI } from './WeBeHomeAPI';
import { Sensor, SensorCategory, SensorData, TitleKey, parseAllDeviceData } from './WeBeHomeSensor';
import { SecuritySystemAccessory } from './SecuritySystemAccessory';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class WeBeHome implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private readonly webehomeapi?: WeBeHomeAPI;
  private readonly sensorAccessories = new Map<number, SensorAccessory>();
  private readonly pollIntervalMs = 30_000;
  private securitySystemAccessory?: SecuritySystemAccessory;
  private securitySystemAccessoryUuid?: string;
  private statusPollTimer?: NodeJS.Timeout;
  private refreshInProgress = false;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);
    if (!this.hasValidConfig(config)) {
      this.log.error('WeBeHome Full is not configured. Set both "login" and "password" in the platform config.');
      return;
    }

    this.webehomeapi = new WeBeHomeAPI(this.log, this.config);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      void this.handleDidFinishLaunching();
    });
    this.api.on('shutdown', () => this.stopPolling());
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  private static isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private hasValidConfig(config: PlatformConfig): boolean {
    return WeBeHome.isNonEmptyString(config['login']) && WeBeHome.isNonEmptyString(config['password']);
  }

  private async handleDidFinishLaunching() {
    this.log.debug('Executed didFinishLaunching callback');
    await this.discoverSensors();
    await this.discoverSecuritySystem();
    this.startPolling();
  }

  private startPolling() {
    if (this.statusPollTimer) {
      return;
    }

    this.statusPollTimer = setInterval(() => {
      void this.refreshAccessories();
    }, this.pollIntervalMs);
  }

  private stopPolling() {
    if (!this.statusPollTimer) {
      return;
    }

    clearInterval(this.statusPollTimer);
    this.statusPollTimer = undefined;
  }

  private async refreshAccessories() {
    if (this.refreshInProgress) {
      return;
    }

    this.refreshInProgress = true;
    try {
      await this.discoverSensors(false);
      await this.discoverSecuritySystem(false);
    } finally {
      this.refreshInProgress = false;
    }
  }

  async discoverSensors(removeStaleAccessories = true) {
    if (!this.webehomeapi) {
      return;
    }

    // Setup the sensors
    try {
      // Fetch the status from the server
      const data = await this.webehomeapi.fetchStatus();

      if (data === null) {
        this.log.warn('Could not fetch data from server. No sensors will be discovered.');
        return;
      }

      // Parse the server response into an array of device data objects
      const deviceDataArray = parseAllDeviceData(data);

      // Filter the device data array and create a new Sensor object from each element
      const sensorDataArray = deviceDataArray.filter(deviceData =>
        deviceData[TitleKey.DESCR] !== '' &&
        deviceData[TitleKey.DESCR] !== undefined &&
        deviceData[TitleKey.CAT] !== undefined &&
        // Stänger av rörelsedetektorer tills vidare
        // [SensorCategory.ContactSensor, SensorCategory.MotionDetector, SensorCategory.SmokeDetector]
        [SensorCategory.ContactSensor, SensorCategory.SmokeDetector]
          .includes(parseInt(deviceData[TitleKey.CAT]!)),
      );
      const seenSensorUuids = new Set<string>();

      // const special = deviceDataArray.filter(deviceData => deviceData[TitleKey.SUID] === '99646');
      // this.log.info('Bakre:', special);

      // loop over the discovered devices and register each one if it has not already been registered
      for (const sensorData of sensorDataArray) {
        const device = new Sensor(this.log, sensorData);
        const uuid = this.api.hap.uuid.generate(device.suid.toString());
        seenSensorUuids.add(uuid);

        let sensorAccessory = this.sensorAccessories.get(device.suid);
        if (sensorAccessory) {
          sensorAccessory.updateSensor(sensorData);
          continue;
        }

        let accessory = this.accessories.find(accessory => accessory.UUID === uuid);
        if (accessory) {
          // the accessory already exists
          // this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          sensorAccessory = new SensorAccessory(this, accessory, device);
          // this.log.debug('Sensor: ', device);

        } else {
          // the accessory does not yet exist, so we need to create it
          this.log.info('Adding new accessory:', device.name);

          // create a new accessory
          accessory = new this.api.platformAccessory(device.name, uuid);

          // store a copy of the device object in the `accessory.context`
          // the `context` property can be used to store any data about the accessory you may need
          accessory.context.device = device;

          // create the accessory handler for the newly create accessory
          // this is imported from `platformAccessory.ts`
          sensorAccessory = new SensorAccessory(this, accessory, device);

          // link the accessory to your platform
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.accessories.push(accessory);
        }

        this.sensorAccessories.set(device.suid, sensorAccessory);
        sensorAccessory.updateSensor(sensorData);
      }

      if (removeStaleAccessories) {
        this.removeStaleSensorAccessories(seenSensorUuids);
      }

      this.log.info('Did finish setting up', sensorDataArray.length, 'sensors');

    } catch (error) {
      this.log.error('Failed to fetch status:', error);
    }
  }

  async discoverSecuritySystem(removeStaleAccessories = true) {
    if (!this.webehomeapi) {
      return;
    }

    // Setup the security system
    try {
      // Fetch the status from the server
      const statusDict = await this.webehomeapi.fetchSecuritySystemStatus();

      // Set up security system

      // create a new accessory
      const name = 'Security system';
      const uuid = this.api.hap.uuid.generate(statusDict.uuid);
      // const accessory = new this.api.platformAccessory(name, uuid);

      let accessory = this.accessories.find(accessory => accessory.UUID === uuid);
      if (this.securitySystemAccessory && this.securitySystemAccessoryUuid === uuid) {
        this.securitySystemAccessory.updateStatus(statusDict);
      } else if (accessory) {
        // the accessory already exists
        // this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);

        // create the accessory handler for the restored accessory
        this.securitySystemAccessory = new SecuritySystemAccessory(this, accessory, statusDict);
        this.securitySystemAccessoryUuid = uuid;

        this.log.debug('Security system:', statusDict);
        this.securitySystemAccessory.updateStatus(statusDict);

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', name);

        // create a new accessory
        accessory = new this.api.platformAccessory(name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.securitySystem = true;
        accessory.context.device = statusDict;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        this.securitySystemAccessory = new SecuritySystemAccessory(this, accessory, statusDict);
        this.securitySystemAccessoryUuid = uuid;

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
      }

      if (removeStaleAccessories) {
        this.removeStaleSecuritySystemAccessories(uuid);
      }

    } catch (error) {
      this.log.error('Failed to fetch status:', error);
    }
  }

  async refreshSecuritySystem(): Promise<void> {
    await this.discoverSecuritySystem(false);
  }

  async fetchStatusForSensor(suid: number): Promise<SensorData | null> {
    if (!this.webehomeapi) {
      this.log.warn(`Cannot fetch sensor ${suid}; WeBeHome Full is not configured.`);
      return null;
    }

    // Fetch the status from the server
    const data = await this.webehomeapi.fetchStatus();

    if (data === null) {
      this.log.warn(`No data fetched for sensor ${suid}`);
      return null;
    }

    // Parse the server response into an array of device data objects
    const deviceDataArray = parseAllDeviceData(data);

    // Find the device data for the sensor with the given SUID
    const sensorData = deviceDataArray.find(deviceData => parseInt(deviceData[TitleKey.SUID] || '0') === suid);

    return sensorData || null;
  }

  async fetchStatusForSecuritySystem(): Promise<SecuritySystemData | null > {
    if (!this.webehomeapi) {
      this.log.warn('Cannot fetch security system status; WeBeHome Full is not configured.');
      return null;
    }

    // Fetch the status from the server
    const data = await this.webehomeapi.fetchSecuritySystemStatus();
    return data;
  }

  async setStateForSecuritySystem(action: string): Promise<void> {
    if (!this.webehomeapi) {
      throw new Error('WeBeHome Full is not configured.');
    }

    await this.webehomeapi.setSecuritySystemTargetState(action);
  }

  private removeStaleSensorAccessories(activeUuids: Set<string>) {
    const staleAccessories = this.accessories.filter(accessory =>
      this.isSensorAccessory(accessory) && !activeUuids.has(accessory.UUID),
    );

    if (staleAccessories.length === 0) {
      return;
    }

    this.log.info('Removing stale WeBeHome sensor accessories:', staleAccessories.map(accessory => accessory.displayName).join(', '));
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    for (const accessory of staleAccessories) {
      const suid = this.getSensorSuid(accessory);
      if (suid !== undefined) {
        this.sensorAccessories.delete(suid);
      }
      this.removeAccessoryFromCache(accessory);
    }
  }

  private removeStaleSecuritySystemAccessories(activeUuid: string) {
    const staleAccessories = this.accessories.filter(accessory =>
      this.isSecuritySystemAccessory(accessory) && accessory.UUID !== activeUuid,
    );

    if (staleAccessories.length === 0) {
      return;
    }

    this.log.info('Removing stale WeBeHome security system accessories:',
      staleAccessories.map(accessory => accessory.displayName).join(', '));
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    for (const accessory of staleAccessories) {
      this.removeAccessoryFromCache(accessory);
    }
  }

  private removeAccessoryFromCache(accessory: PlatformAccessory) {
    const index = this.accessories.findIndex(cachedAccessory => cachedAccessory.UUID === accessory.UUID);
    if (index !== -1) {
      this.accessories.splice(index, 1);
    }
  }

  private isSensorAccessory(accessory: PlatformAccessory): boolean {
    return this.getSensorSuid(accessory) !== undefined;
  }

  private getSensorSuid(accessory: PlatformAccessory): number | undefined {
    const context = accessory.context as Record<string, unknown>;
    const sensor = context.sensor as Record<string, unknown> | undefined;
    const device = context.device as Record<string, unknown> | undefined;
    const value = sensor?.suid ?? device?.suid;

    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsedValue = Number.parseInt(value, 10);
      return Number.isNaN(parsedValue) ? undefined : parsedValue;
    }

    return undefined;
  }

  private isSecuritySystemAccessory(accessory: PlatformAccessory): boolean {
    const context = accessory.context as Record<string, unknown>;
    const device = context.device as Record<string, unknown> | undefined;

    return context.securitySystem === true ||
      (typeof context.uuid === 'string' && typeof context.status === 'string') ||
      (typeof device?.uuid === 'string' && typeof device?.status === 'string');
  }

}
