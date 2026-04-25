import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { WeBeHome } from './WeBeHomePlatform';
import { ContactSensorState, Sensor, SensorCategory, SensorData, SmokeDetectionState } from './WeBeHomeSensor';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SensorAccessory {
  private readonly service: Service;

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
    let service: Service;

    switch (parseInt(this.sensor.deviceCategory)) {
      case SensorCategory.ContactSensor:
        if (this.accessory.getService(this.platform.Service.ContactSensor)) {
          serviceExists = true;
          service = this.accessory.getService(this.platform.Service.ContactSensor)!;
        } else {
          service = new this.platform.Service.ContactSensor(sensor.name, sensor.suid.toString());
        }

        service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(this.handleContactSensorStateGet.bind(this));

        break;
      case SensorCategory.SmokeDetector:
        if (this.accessory.getService(this.platform.Service.SmokeSensor)) {
          serviceExists = true;
          service = this.accessory.getService(this.platform.Service.SmokeSensor)!;
        } else {
          service = new this.platform.Service.SmokeSensor(sensor.name, sensor.suid.toString());
        }

        service.getCharacteristic(this.platform.Characteristic.SmokeDetected)
          .onGet(this.handleSmokeDetectedGet.bind(this));

        break;
      default:
        throw new Error(`Unsupported WeBeHome sensor category: ${this.sensor.deviceCategory}`);

    }

    this.service = service;

    // sensor.log.debug('Did set up sensor', sensor.description);
    this.service.setCharacteristic(this.platform.Characteristic.Name, sensor.description);
    this.service.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.handleStatusLowBatteryGet.bind(this));

    // Only add the service to the accessory if it didn't exist already
    if (!serviceExists) {
      this.accessory.addService(this.service);
    }

    this.updateHomeKitCharacteristics();

  }

  updateSensor(sensorData: SensorData) {
    this.sensor.updateState(sensorData);
    this.updateHomeKitCharacteristics();
  }

  handleContactSensorStateGet(): CharacteristicValue {
    this.requestFreshState();
    return this.contactSensorState();
  }

  handleSmokeDetectedGet(): CharacteristicValue {
    this.requestFreshState();
    return this.smokeDetectedState();
  }

  handleStatusLowBatteryGet(): CharacteristicValue {
    this.requestFreshState();
    return this.statusLowBatteryState();
  }

  private updateHomeKitCharacteristics() {
    this.service.updateCharacteristic(this.platform.Characteristic.Name, this.sensor.description);
    this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.statusLowBatteryState());

    switch (parseInt(this.sensor.deviceCategory)) {
      case SensorCategory.ContactSensor:
        this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.contactSensorState());
        break;
      case SensorCategory.SmokeDetector:
        this.service.updateCharacteristic(this.platform.Characteristic.SmokeDetected, this.smokeDetectedState());
        break;
    }
  }

  private contactSensorState(): number {
    return this.sensor.getState() === ContactSensorState.Open ?
      this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED :
      this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  private smokeDetectedState(): number {
    return this.sensor.getState() === SmokeDetectionState.NotDetected ?
      this.platform.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED :
      this.platform.Characteristic.SmokeDetected.SMOKE_DETECTED;
  }

  private statusLowBatteryState(): number {
    return this.sensor.hasLowBattery() ?
      this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
      this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  private requestFreshState() {
    void this.platform.requestSensorRefresh(this.sensor.suid);
  }

}
