import { Service, PlatformAccessory, CharacteristicGetCallback } from 'homebridge';

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

    let isOpen = true;

    const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
    if (sensorData) {
      this.updateSensor(sensorData);
      isOpen = this.sensor.getState() === ContactSensorState.Open;

      if (isOpen) {
        this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      } else {
        this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
      }

      // this.platform.log.debug('Current state of the contact sensor', this.sensor.name, 'is:', isOpen ? 'OPEN' : 'CLOSED');
    }

    // return the current value to Homebridge
    callback(null, isOpen);
  }

  async handleMotionSensorStateGet(callback: CharacteristicGetCallback) {

    let isMotionDetected = false;

    const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
    if (sensorData) {
      this.updateSensor(sensorData);
      isMotionDetected = this.sensor.getState() === MotionDetectionState.Detected;

      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, isMotionDetected);
    }

    // Log the current motion detected state
    // this.platform.log.debug('Current state of the motion sensor is:', isMotionDetected ? 'DETECTED' : 'NOT DETECTED');

    // you should always call the callback function, even if there was an error, but pass it as the first argument to the function
    callback(null, isMotionDetected);
  }

  async handleSmokeDetectedGet(callback: CharacteristicGetCallback) {

    let isSmokeDetected = false;

    const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
    if (sensorData) {
      this.updateSensor(sensorData);
      isSmokeDetected = !(this.sensor.getState() === SmokeDetectionState.NotDetected);

      // Update the smoke detected characteristic
      this.service.updateCharacteristic(this.platform.Characteristic.SmokeDetected, isSmokeDetected);
    }

    // Log the current smoke detected state
    // this.platform.log.debug('Current state of the smoke sensor', this.sensor.name, 'is:',
    // isSmokeDetected ? 'SMOKE DETECTED' : 'SMOKE NOT DETECTED');

    // you should always call the callback function, even if there was an error, but pass it as the first argument to the function
    callback(null, isSmokeDetected);
  }

  async handleStatusLowBatteryGet(callback: CharacteristicGetCallback) {
    // Here you must implement your own logic to get the actual value from the sensor
    // Let's assume you have a method `isLowBattery()` in the Sensor class to check if the sensor battery is low

    let isLowBattery = false;

    const sensorData = await this.platform.fetchStatusForSensor(this.sensor.suid);
    if (sensorData) {
      this.updateSensor(sensorData);
      isLowBattery = this.sensor.hasLowBattery();

      if (isLowBattery) {
        this.platform.log.info(this.sensor.name, 'has low battery');
      }
      // this.platform.log.debug('Current battery status of the sensor', this.sensor.name, 'is:', isLowBattery ? 'LOW' : 'NORMAL');
    }

    callback(null, isLowBattery ?
      this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
      this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  }


}
