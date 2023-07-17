import fetch from 'node-fetch';
import { PlatformConfig, Logger, CharacteristicSetCallback } from 'homebridge';

export type SecuritySystemData = {
    uuid: string;
    status: string;
  };

export class WeBeHomeAPI {
  private log: Logger;
  private config: PlatformConfig;
  private login: string;
  private password: string;

  private fetching: Promise<string | null> | null = null;

  private readonly throttleTime = 5000; // 5000 milliseconds = 5 seconds
  private lastFetched = 0;
  private cache: string | null = null;
  private securitySystemLastFetched = 0;
  private securitySystemCache: SecuritySystemData | null = null;

  constructor(log: Logger, config: PlatformConfig) {
    this.log = log;
    this.config = config;
    this.login = config['login'];
    this.password = config['password'];
  }

  async fetchStatus(): Promise<string | null> {
    const now = Date.now();

    // If it's been less than 5 seconds since the last fetch, return the cached data
    if (now - this.lastFetched < this.throttleTime && this.cache !== null) {
    //   this.log.debug('Returning cached sensor status');
      return this.cache;
    }

    // If a fetch is already in progress, return the existing promise
    if (this.fetching) {
      return this.fetching;
    }

    // If it's been more than 5 seconds since the last fetch, fetch new data
    this.log.debug('Fetching new sensor status');
    const url = `https://webehome.com/API/WebAPI.aspx?Function=GetSubUnitStatus&LoginName=${this.login}&Password=${this.password}`;
    const options = {
      headers: {
        'User-Agent': 'request',
      },
    };

    // Save the promise so other calls can use it
    this.fetching = this.fetchData(url, options);

    // Don't forget to reset fetching to null once it's done
    this.fetching.finally(() => {
      this.fetching = null;
    });

    return this.fetching;
  }


  private async fetchData(url: string, options: object): Promise<string | null> {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.text();

    this.lastFetched = Date.now();
    this.fetching = null;  // Reset the fetching promise
    return this.cache = data;
  }

  async fetchSecuritySystemStatus(): Promise<SecuritySystemData> {
    const now = Date.now();

    if (now - this.securitySystemLastFetched < this.throttleTime && this.securitySystemCache !== null) {
      // If it's been less than 5 seconds since the last fetch, return the cached data
    //   this.log.debug('Returning cached sensor status');
      return this.securitySystemCache;
    }

    // If it's been more than 5 seconds since the last fetch, fetch new data
    this.log.debug('Fetching new security system status');

    // eslint-disable-next-line max-len
    const url = `https://webehome.com/Public/login.aspx?LoginName=${this.login}&Password=${this.password}&Action=statusdetailed&ActionOnly=yes`;
    const options = {
      headers: {
        'User-Agent': 'request',
      },
    };

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.text();

    // First, split the string into an array on the ':' character
    const splitResponse = data.split(':');

    // The parts you're interested in are the second (index 1) and third (index 2) parts
    const uuid = splitResponse[1].trim();  // trim() is used to remove any leading or trailing whitespace
    const status = splitResponse[2].trim();

    // Now you can create your dictionary
    const result: SecuritySystemData = {
      uuid,
      status,
    };

    this.securitySystemCache = result;
    this.securitySystemLastFetched = now;

    return this.securitySystemCache;
  }

  async setSecuritySystemTargetState(
    action: string,
    callback: CharacteristicSetCallback) {
    try {
      this.log.info('Invoking action', action);

      // Create the URL for the fetch call
      // eslint-disable-next-line max-len
      const url = `https://webehome.com/Public/login.aspx?LoginName=${this.login}&Password=${this.password}&Action=${action}&ActionOnly=yes`;

      // Make the fetch call
      const response = await fetch(url, { method: 'POST' });

      // Check if the request was successful
      if (!response.ok) {
        throw new Error(`Failed to set state. Server responded with ${response.status}`);
      }

      // Success! No errors, so call the callback with no arguments
      callback();
    } catch (error) {
      this.log.error('Error setting state:', error);

      // Error! Call the callback with the error
      callback(error as Error);

    }
  }
}