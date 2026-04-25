import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
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
    this.accessory.context.securitySystem = true;
    this.accessory.context.device = statusDict;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WeBeHome')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, statusDict.uuid);

    let serviceExists = false;

    if (this.accessory.getService(this.platform.Service.SecuritySystem)) {
      serviceExists = true;
      this.service = this.accessory.getService(this.platform.Service.SecuritySystem)!;
    } else {
      this.service = new this.platform.Service.SecuritySystem();
    }

    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .onGet(this.handleSecuritySystemStateGet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .onGet(this.handleSecuritySystemTargetStateGet.bind(this))
      .onSet(this.handleSecuritySystemStateSet.bind(this));

    // Only add the service to the accessory if it didn't exist already
    if (!serviceExists) {
      this.accessory.addService(this.service);
    }

    this.updateStatus(statusDict);

  }

  updateStatus(data: SecuritySystemData) {
    this.statusDict = data;
    this.accessory.context.securitySystem = true;
    this.accessory.context.device = data;

    const currentState = this.mapServerStateToHomebridgeState(data.status);
    this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState, currentState);
    this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemTargetState,
      this.mapServerStateToHomebridgeTargetState(data.status));
  }

  handleSecuritySystemStateGet(): CharacteristicValue {
    try {
      this.requestFreshState();
      const state = this.mapServerStateToHomebridgeState(this.statusDict.status);
      this.platform.log.debug('Current state of security system:', state);
      return state;
    } catch (error) {
      this.platform.log.error('Failed to get security system state:', error);
      throw this.communicationError();
    }
  }

  handleSecuritySystemTargetStateGet(): CharacteristicValue {
    try {
      this.requestFreshState();
      return this.mapServerStateToHomebridgeTargetState(this.statusDict.status);
    } catch (error) {
      this.platform.log.error('Failed to get security system target state:', error);
      throw this.communicationError();
    }
  }

  async handleSecuritySystemStateSet(newValue: CharacteristicValue): Promise<void> {
    try {
      if (typeof newValue !== 'number') {
        throw new Error(`Invalid target state: ${newValue}`);
      }

      const action = this.mapTargetStateToAction(newValue);
      await this.platform.setStateForSecuritySystem(action);
      this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemTargetState, newValue);
      await this.platform.refreshSecuritySystem(true);
    } catch (error) {
      this.platform.log.error('Failed to set security system state:', error);
      throw this.communicationError();
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

  mapServerStateToHomebridgeTargetState(serverState: string): number {
    switch(serverState) {
      case ServerState.StayArm:
        return this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM;
      case ServerState.AwayArm:
      case ServerState.AlarmTriggered:
        return this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM;
      case ServerState.Disarmed:
        return this.platform.Characteristic.SecuritySystemTargetState.DISARM;
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

  private communicationError(): Error {
    return new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private requestFreshState() {
    void this.platform.requestSecuritySystemRefresh();
  }

}
