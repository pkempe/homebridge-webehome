import type { API, DynamicPlatformPlugin, Logger,
  PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SensorAccessory } from './SensorAccessory';
import { WeBeHomeAPI } from './WeBeHomeAPI';
import { Sensor, SensorCategory, SensorData, TitleKey, hasParseableDeviceRows, parseAllDeviceData } from './WeBeHomeSensor';
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
  private readonly rediscoveryIntervalMs = 300_000;
  private readonly accessRefreshCooldownMs = 5_000;
  private securitySystemAccessory?: SecuritySystemAccessory;
  private securitySystemAccessoryUuid?: string;
  private statusPollTimer?: NodeJS.Timeout;
  private rediscoveryPollTimer?: NodeJS.Timeout;
  private refreshInProgress = false;
  private readonly sensorAccessRefreshes = new Map<number, Promise<void>>();
  private readonly sensorAccessRefreshLastAttempt = new Map<number, number>();
  private securitySystemAccessRefresh?: Promise<void>;
  private securitySystemAccessRefreshLastAttempt = 0;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);
    if (!this.hasValidConfig(config)) {
      this.log.error('WeBeHome is not configured. Set both "login" and "password" in the platform config.');
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
    if (!this.statusPollTimer) {
      this.statusPollTimer = setInterval(() => {
        void this.refreshAccessories();
      }, this.pollIntervalMs);
    }

    if (!this.rediscoveryPollTimer) {
      this.rediscoveryPollTimer = setInterval(() => {
        void this.rediscoverAccessories();
      }, this.rediscoveryIntervalMs);
    }
  }

  private stopPolling() {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = undefined;
    }

    if (this.rediscoveryPollTimer) {
      clearInterval(this.rediscoveryPollTimer);
      this.rediscoveryPollTimer = undefined;
    }
  }

  private async refreshAccessories() {
    if (this.refreshInProgress) {
      return;
    }

    this.refreshInProgress = true;
    try {
      await Promise.allSettled([
        this.refreshSensors(),
        this.refreshSecuritySystem(),
      ]);
    } finally {
      this.refreshInProgress = false;
    }
  }

  private async rediscoverAccessories() {
    if (this.refreshInProgress) {
      return;
    }

    this.refreshInProgress = true;
    try {
      await this.discoverSensors();
      await this.discoverSecuritySystem();
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
      const sensorDataArray = await this.fetchSupportedSensorData();
      if (!sensorDataArray) {
        return;
      }

      const seenSensorUuids = new Set<string>();

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

  async refreshSensors(forceRefresh = false): Promise<void> {
    try {
      const sensorDataArray = await this.fetchSupportedSensorData(forceRefresh);
      if (!sensorDataArray) {
        return;
      }

      let updatedSensors = 0;
      for (const sensorData of sensorDataArray) {
        const suid = parseInt(sensorData[TitleKey.SUID] || '0');
        const sensorAccessory = this.sensorAccessories.get(suid);
        if (sensorAccessory) {
          sensorAccessory.updateSensor(sensorData);
          updatedSensors++;
        }
      }

      this.log.debug('Did finish refreshing', updatedSensors, 'known sensors');
    } catch (error) {
      this.log.error('Failed to refresh sensors:', error);
    }
  }

  async refreshSensor(suid: number, forceRefresh = false): Promise<void> {
    const sensorAccessory = this.sensorAccessories.get(suid);
    if (!sensorAccessory) {
      return;
    }

    try {
      const sensorData = await this.fetchStatusForSensor(suid, forceRefresh);
      if (sensorData) {
        sensorAccessory.updateSensor(sensorData);
      }
    } catch (error) {
      this.log.error('Failed to refresh sensor:', suid, error);
    }
  }

  requestSensorRefresh(suid: number): Promise<void> {
    const existingRefresh = this.sensorAccessRefreshes.get(suid);
    if (existingRefresh) {
      return existingRefresh;
    }

    const now = Date.now();
    const lastAttempt = this.sensorAccessRefreshLastAttempt.get(suid) || 0;
    if (now - lastAttempt < this.accessRefreshCooldownMs) {
      return Promise.resolve();
    }

    this.sensorAccessRefreshLastAttempt.set(suid, now);
    const refresh = this.refreshSensor(suid, true).finally(() => {
      this.sensorAccessRefreshes.delete(suid);
    });
    this.sensorAccessRefreshes.set(suid, refresh);

    return refresh;
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

  async refreshSecuritySystem(forceRefresh = false): Promise<void> {
    if (!this.webehomeapi) {
      return;
    }

    try {
      const statusDict = await this.webehomeapi.fetchSecuritySystemStatus(forceRefresh);
      if (this.securitySystemAccessory) {
        this.securitySystemAccessory.updateStatus(statusDict);
      }
    } catch (error) {
      this.log.error('Failed to refresh security system status:', error);
    }
  }

  requestSecuritySystemRefresh(): Promise<void> {
    if (this.securitySystemAccessRefresh) {
      return this.securitySystemAccessRefresh;
    }

    const now = Date.now();
    if (now - this.securitySystemAccessRefreshLastAttempt < this.accessRefreshCooldownMs) {
      return Promise.resolve();
    }

    this.securitySystemAccessRefreshLastAttempt = now;
    this.securitySystemAccessRefresh = this.refreshSecuritySystem(true).finally(() => {
      this.securitySystemAccessRefresh = undefined;
    });

    return this.securitySystemAccessRefresh;
  }

  async fetchStatusForSensor(suid: number, forceRefresh = false): Promise<SensorData | null> {
    if (!this.webehomeapi) {
      this.log.warn(`Cannot fetch sensor ${suid}; WeBeHome is not configured.`);
      return null;
    }

    // Fetch the status from the server
    const data = await this.webehomeapi.fetchStatus(forceRefresh);

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

  async setStateForSecuritySystem(action: string): Promise<void> {
    if (!this.webehomeapi) {
      throw new Error('WeBeHome is not configured.');
    }

    await this.webehomeapi.setSecuritySystemTargetState(action);
  }

  private async fetchSupportedSensorData(forceRefresh = false): Promise<SensorData[] | null> {
    if (!this.webehomeapi) {
      return null;
    }

    // Fetch the status from the server
    const data = await this.webehomeapi.fetchStatus(forceRefresh);

    if (data === null) {
      this.log.warn('Could not fetch data from server. No sensors will be discovered.');
      return null;
    }

    // Parse the server response into an array of device data objects
    const deviceDataArray = parseAllDeviceData(data);
    if (!hasParseableDeviceRows(deviceDataArray)) {
      this.log.warn('WeBeHome sensor status response did not contain parseable device rows. Skipping sensor updates.');
      return null;
    }

    // Motion detectors are deliberately excluded until their OperationStatus values are verified.
    return deviceDataArray.filter(deviceData =>
      deviceData[TitleKey.DESCR] !== '' &&
      deviceData[TitleKey.DESCR] !== undefined &&
      deviceData[TitleKey.CAT] !== undefined &&
      [SensorCategory.ContactSensor, SensorCategory.SmokeDetector]
        .includes(parseInt(deviceData[TitleKey.CAT]!)),
    );
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
