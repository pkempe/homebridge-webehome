import { CharacteristicGetCallback, CharacteristicSetCallback, PlatformAccessory, Service } from 'homebridge';
import { WeBeHome } from './WeBeHomePlatform';

export type SecuritySystemData = {
  uuid: string;
  status: string;
};

export enum ServerState {
  /** Avlarmat */
  StayArm = 'Avlarmat',
  /** Larmat i Bortaläge */
  AwayArm = 'Larmat i Bortaläge',
  /** Larmat i Hemmaläge */
  NightArm = 'Larmat i Hemmaläge',
  Disarmed = 'Disarmed', // You'll need to fill this in
  AlarmTriggered = 'AlarmTriggered', // And this one too
}

export class SecuritySystemAccessory {

  private service!: Service;

  constructor(
    private readonly platform: WeBeHome,
    private readonly accessory: PlatformAccessory,
    private statusDict: SecuritySystemData,

  ) {

    this.statusDict = statusDict;
    this.accessory.context = statusDict;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WeBeHome');

    let serviceExists = false;

    if (this.accessory.getService(this.platform.Service.SecuritySystem)) {
      serviceExists = true;
      this.service = this.accessory.getService(this.platform.Service.SecuritySystem)!;
    } else {
      this.service = new this.platform.Service.SecuritySystem();
    }

    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .on('get', this.handleSecuritySystemStateGet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .on('set', this.handleSecuritySystemStateSet.bind(this));

    // Only add the service to the accessory if it didn't exist already
    if (!serviceExists) {
      this.accessory.addService(this.service);
    }

  }

  updateStatus(data: SecuritySystemData) {
    this.statusDict.status = data.status;
  }

  async handleSecuritySystemStateGet(callback: CharacteristicGetCallback) {

    let state = this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM;
    const statusData = await this.platform.fetchStatusForSecuritySystem();

    if (statusData) {
      this.updateStatus(statusData);

      switch (statusData.status) {
        case ServerState.StayArm:
          state = this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM;
          break;
        case ServerState.NightArm:
          state = this.platform.Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
          break;
        case ServerState.AwayArm:
          state = this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM;
          break;
      }

      this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState,
        state);

      this.platform.log.debug('Current state of security system:', state);

    }

    callback(null, state);

  }

  async handleSecuritySystemStateSet(newValue, callback: CharacteristicSetCallback) {
    // this.platform.log.debug('Will set state', newValue);

    const action = this.mapTargetStateToAction(newValue);
    await this.platform.setStateForSecuritySystem(action, callback);

  }

  mapHomebridgeStateToServerState(homebridgeState: number): string {
    switch(homebridgeState) {
      case this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM:
        return ServerState.StayArm;
      case this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM:
        return ServerState.AwayArm;
      case this.platform.Characteristic.SecuritySystemCurrentState.NIGHT_ARM:
        return ServerState.NightArm;
      case this.platform.Characteristic.SecuritySystemCurrentState.DISARMED:
        return ServerState.StayArm;
      default:
        throw new Error(`Invalid Homebridge state: ${homebridgeState}`);
    }
  }

  mapServerStateToHomebridgeState(serverState: string): number {
    switch(serverState) {
      case ServerState.StayArm:
        return this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM;
      case ServerState.AwayArm:
        return this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM;
      case ServerState.NightArm:
        return this.platform.Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
      default:
        throw new Error(`Invalid server state: ${serverState}`);
    }
  }

  mapTargetStateToAction(targetState: number): string {
    if (targetState === this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM) {
      return 'disarm';
    } else if (targetState === this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM) {
      return 'away';
    } else if (targetState === this.platform.Characteristic.SecuritySystemTargetState.NIGHT_ARM) {
      return 'home';
    } else {
      throw new Error(`Invalid target state: ${targetState}`);
    }
  }

}
