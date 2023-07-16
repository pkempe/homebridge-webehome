import fetch from 'node-fetch';
import { PlatformConfig, Logger } from 'homebridge';
// import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

export class WeBeHomeAPI {
  private log: Logger;
  private config: PlatformConfig;
  private login: string;
  private password: string;

  private readonly throttleTime = 5000; // 5000 milliseconds = 5 seconds
  private lastFetched = 0;
  private cache: string | null = null;

  constructor(log: Logger, config: PlatformConfig) {
    this.log = log;
    this.config = config;
    this.login = config['login'];
    this.password = config['password'];
    this.log.debug('Setting up WeBeHome API');
  }

  async fetchStatus() {
    const now = Date.now();

    if (now - this.lastFetched < this.throttleTime && this.cache !== null) {
      // If it's been less than 5 seconds since the last fetch, return the cached data
    //   this.log.debug('Returning cached sensor status');
      return this.cache;
    }

    // If it's been more than 5 seconds since the last fetch, fetch new data
    this.log.debug('Fetching new sensor status');

    const url = `https://webehome.com/API/WebAPI.aspx?Function=GetSubUnitStatus&LoginName=${this.login}&Password=${this.password}`;
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
    this.cache = data;

    this.lastFetched = now;

    return this.cache;
  }

}