import { CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { WeBeHome } from './WeBeHomePlatform';

export type SecuritySystemData = {
  uuid: string;
  status: string;
};

export enum ServerState {
  /** Armed in away mode. */
  AwayArm = 'Larmat i Bortaläge',
  /** Armed in home/stay mode. */
  StayArm = 'Larmat i Hemmaläge',
  /** Disarmed. */
  Disarmed = 'Avlarmat',
  AlarmTriggered = 'AlarmTriggered',
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

    try {
      const statusData = await this.platform.fetchStatusForSecuritySystem();
      if (!statusData) {
        throw new Error('No security system status was returned');
      }

      this.updateStatus(statusData);
      const state = this.mapServerStateToHomebridgeState(statusData.status);

      this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState,
        state);

      this.platform.log.debug('Current state of security system:', state);
      callback(null, state);
    } catch (error) {
      this.platform.log.error('Failed to get security system state:', error);
      callback(error as Error);
    }

  }

  async handleSecuritySystemStateSet(newValue: CharacteristicValue, callback: CharacteristicSetCallback) {
    try {
      if (typeof newValue !== 'number') {
        throw new Error(`Invalid target state: ${newValue}`);
      }

      const action = this.mapTargetStateToAction(newValue);
      await this.platform.setStateForSecuritySystem(action);
      callback();
    } catch (error) {
      this.platform.log.error('Failed to set security system state:', error);
      callback(error as Error);
    }

  }

  mapHomebridgeStateToServerState(homebridgeState: number): string {
    switch(homebridgeState) {
      case this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM:
        return ServerState.StayArm;
      case this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM:
        return ServerState.AwayArm;
      case this.platform.Characteristic.SecuritySystemCurrentState.NIGHT_ARM:
        return ServerState.StayArm;
      case this.platform.Characteristic.SecuritySystemCurrentState.DISARMED:
        return ServerState.Disarmed;
      case this.platform.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED:
        return ServerState.AlarmTriggered;
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
      case ServerState.Disarmed:
        return this.platform.Characteristic.SecuritySystemCurrentState.DISARMED;
      case ServerState.AlarmTriggered:
        return this.platform.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
      default:
        throw new Error(`Invalid server state: ${serverState}`);
    }
  }

  mapTargetStateToAction(targetState: number): string {
    if (targetState === this.platform.Characteristic.SecuritySystemTargetState.DISARM) {
      return 'disarm';
    } else if (targetState === this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM) {
      return 'away';
    } else if (
      targetState === this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM ||
      targetState === this.platform.Characteristic.SecuritySystemTargetState.NIGHT_ARM
    ) {
      return 'home';
    } else {
      throw new Error(`Invalid target state: ${targetState}`);
    }
  }

}
