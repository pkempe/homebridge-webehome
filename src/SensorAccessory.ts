import type { Service, PlatformAccessory, CharacteristicGetCallback } from 'homebridge';

import { WeBeHome } from './WeBeHomePlatform';
import { ContactSensorState, MotionDetectionState, Sensor, SensorCategory, SensorData, SmokeDetectionState } from './WeBeHomeSensor';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SensorAccessory {
  private service!: Service;

  constructor(
    private readonly platform: WeBeHome,
    private readonly accessory: PlatformAccessory,
    private sensor: Sensor,
  ) {

    this.sensor = sensor;
    this.accessory.context.sensor = sensor;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, sensor.manufacturer)
      .setCharacteristic(this.platform.Characteristic.Model, sensor.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, sensor.suid.toString());

    let serviceExists = false;

    switch (parseInt(this.sensor.deviceCategory)) {
      case SensorCategory.ContactSensor:
        if (this.accessory.getService(this.platform.Service.ContactSensor)) {
          serviceExists = true;
          this.service = this.accessory.getService(this.platform.Service.ContactSensor)!;
        } else {
          this.service = new this.platform.Service.ContactSensor(sensor.name, sensor.suid.toString());
        }

        this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .on('get', this.handleContactSensorStateGet.bind(this));

        break;
        // Stänger av, batterierna är slut i alla enheter och jag vet inte vilket värde på OperationStatus som motsvarar
        // rörelse upptäckt.
        // case SensorCategory.MotionDetector:
        //   if (this.accessory.getService(this.platform.Service.MotionSensor)) {
        //     serviceExists = true;
        //     this.service = this.accessory.getService(this.platform.Service.MotionSensor)!;
        //   } else {
        //     this.service = new this.platform.Service.MotionSensor(sensor.name, sensor.suid.toString());
        //   }

        //   this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
        //     .on('get', this.handleMotionSensorStateGet.bind(this));

      //   break;
      case SensorCategory.SmokeDetector:
        if (this.accessory.getService(this.platform.Service.SmokeSensor)) {
          serviceExists = true;
          this.service = this.accessory.getService(this.platform.Service.SmokeSensor)!;
        } else {
          this.service = new this.platform.Service.SmokeSensor(sensor.name, sensor.suid.toString());
        }

        this.service.getCharacteristic(this.platform.Characteristic.SmokeDetected)
          .on('get', this.handleSmokeDetectedGet.bind(this));

        break;

    }

    // sensor.log.debug('Did set up sensor', sensor.description);
    this.service.setCharacteristic(this.platform.Characteristic.Name, sensor.description);
    this.service.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .on('get', this.handleStatusLowBatteryGet.bind(this));

    // Only add the service to the accessory if it didn't exist already
    if (!serviceExists) {
      this.accessory.addService(this.service);
    }

  }

  updateSensor(sensorData: SensorData) {
    this.sensor.updateState(sensorData);
  }

  async handleContactSensorStateGet(callback: CharacteristicGetCallback) {

    try {
      let state = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

      const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
      if (sensorData) {
        this.updateSensor(sensorData);
        state = this.sensor.getState() === ContactSensorState.Open ?
          this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED :
          this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;

        // this.platform.log.debug('Current state of the contact sensor', this.sensor.name,
        // 'is:', state === this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED ? 'OPEN' : 'CLOSED');
      }

      callback(null, state);
    } catch (error) {
      this.platform.log.error('Failed to get contact sensor state for', this.sensor.name, error);
      callback(error as Error);
    }
  }

  async handleMotionSensorStateGet(callback: CharacteristicGetCallback) {

    try {
      let isMotionDetected = false;

      const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
      if (sensorData) {
        this.updateSensor(sensorData);
        isMotionDetected = this.sensor.getState() === MotionDetectionState.Detected;

        this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, isMotionDetected);
      }

      // this.platform.log.debug('Current state of the motion sensor is:', isMotionDetected ? 'DETECTED' : 'NOT DETECTED');
      callback(null, isMotionDetected);
    } catch (error) {
      this.platform.log.error('Failed to get motion sensor state for', this.sensor.name, error);
      callback(error as Error);
    }
  }

  async handleSmokeDetectedGet(callback: CharacteristicGetCallback) {

    try {
      let state = this.platform.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;

      const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
      if (sensorData) {
        this.updateSensor(sensorData);
        state = this.sensor.getState() === SmokeDetectionState.NotDetected ?
          this.platform.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED :
          this.platform.Characteristic.SmokeDetected.SMOKE_DETECTED;

        this.service.updateCharacteristic(this.platform.Characteristic.SmokeDetected, state);
      }

      // this.platform.log.debug('Current state of the smoke sensor', this.sensor.name, 'is:',
      // state === this.platform.Characteristic.SmokeDetected.SMOKE_DETECTED ? 'SMOKE DETECTED' : 'SMOKE NOT DETECTED');

      callback(null, state);
    } catch (error) {
      this.platform.log.error('Failed to get smoke sensor state for', this.sensor.name, error);
      callback(error as Error);
    }
  }

  async handleStatusLowBatteryGet(callback: CharacteristicGetCallback) {
    try {
      let isLowBattery = false;

      const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
      if (sensorData) {
        this.updateSensor(sensorData);
        isLowBattery = this.sensor.hasLowBattery();

        if (isLowBattery) {
          this.platform.log.info(this.sensor.name, 'has low battery');
        }
        // this.platform.log.debug('Current battery status of the sensor', this.sensor.name,
        // 'is:', isLowBattery ? 'LOW' : 'NORMAL');
      }

      callback(null, isLowBattery ?
        this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
        this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    } catch (error) {
      this.platform.log.error('Failed to get battery status for', this.sensor.name, error);
      callback(error as Error);
    }
  }


}
