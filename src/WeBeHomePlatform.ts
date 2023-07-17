import { API, DynamicPlatformPlugin, Logger,
  PlatformAccessory, PlatformConfig, Service, Characteristic, CharacteristicSetCallback } from 'homebridge';

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
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private readonly webehomeapi: WeBeHomeAPI;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    this.webehomeapi = new WeBeHomeAPI(this.log, this.config);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverSensors();
      this.discoverSecuritySystem();
    });
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
  async discoverSensors() {

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
      const sensors = deviceDataArray
        .filter(deviceData =>
          deviceData[TitleKey.DESCR] !== '' &&
          deviceData[TitleKey.DESCR] !== undefined &&
          deviceData[TitleKey.CAT] !== undefined &&
          // Stänger av rörelsedetektorer tills vidare
          // [SensorCategory.ContactSensor, SensorCategory.MotionDetector, SensorCategory.SmokeDetector]
          [SensorCategory.ContactSensor, SensorCategory.SmokeDetector]
            .includes(parseInt(deviceData[TitleKey.CAT]!)),
        )
        .map(deviceData => new Sensor(this.log, deviceData));

      // const special = deviceDataArray.filter(deviceData => deviceData[TitleKey.SUID] === '99646');
      // this.log.info('Bakre:', special);

      // loop over the discovered devices and register each one if it has not already been registered
      for (let i = 0; i < sensors.length; i++) {
        const device = sensors[i];
        const uuid = this.api.hap.uuid.generate(device.suid.toString());
        const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
        if (existingAccessory) {
          // the accessory already exists
          // this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          const sensorAccessory = new SensorAccessory(this, existingAccessory, device);
          // this.log.debug('Sensor: ', device);
          sensorAccessory.updateSensor(deviceDataArray[i]);

        } else {
          // the accessory does not yet exist, so we need to create it
          this.log.info('Adding new accessory:', device.name);

          // create a new accessory
          const accessory = new this.api.platformAccessory(device.name, uuid);

          // store a copy of the device object in the `accessory.context`
          // the `context` property can be used to store any data about the accessory you may need
          accessory.context.device = device;

          // create the accessory handler for the newly create accessory
          // this is imported from `platformAccessory.ts`
          new SensorAccessory(this, accessory, device);

          // link the accessory to your platform
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }

      this.log.info('Did finish setting up', sensors.length, 'sensors');

    } catch (error) {
      this.log.error('Failed to fetch status:', error);
    }
  }

  async discoverSecuritySystem() {
    // Setup the security system
    try {
      // Fetch the status from the server
      const statusDict = await this.webehomeapi.fetchSecuritySystemStatus();

      // Set up security system

      // create a new accessory
      const name = 'Security system';
      const uuid = this.api.hap.uuid.generate(statusDict.uuid);
      // const accessory = new this.api.platformAccessory(name, uuid);

      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
      if (existingAccessory) {
        // the accessory already exists
        // this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);

        // create the accessory handler for the restored accessory
        const securitySystem = new SecuritySystemAccessory(this, existingAccessory, statusDict);

        this.log.debug('Security system:', statusDict);
        securitySystem.updateStatus(statusDict);

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = statusDict;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new SecuritySystemAccessory(this, accessory, statusDict);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

    } catch (error) {
      this.log.error('Failed to fetch status:', error);
    }
  }

  async fetchStatusForSensor(suid: number): Promise<SensorData | null> {
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
    // Fetch the status from the server
    const data = await this.webehomeapi.fetchSecuritySystemStatus();
    return data;
  }

  async setStateForSecuritySystem(action: string, callback: CharacteristicSetCallback) {
    await this.webehomeapi.setSecuritySystemTargetState(action, callback);
  }

}
