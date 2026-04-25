import type { PlatformConfig, Logger } from 'homebridge';
import { URLSearchParams } from 'url';

export type SecuritySystemData = {
  uuid: string;
  status: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export type FetchClient = (url: string, options?: object) => Promise<FetchResponse>;

async function defaultFetchClient(url: string, options?: object): Promise<FetchResponse> {
  const nodeFetch = await import('node-fetch');
  const fetchClient = nodeFetch.default as unknown as FetchClient;

  return fetchClient(url, options);
}

export function parseSecuritySystemStatus(data: string): SecuritySystemData {
  const splitResponse = data.split(':');
  const uuid = splitResponse[1]?.trim();
  const status = splitResponse.slice(2).join(':').trim();
  if (!uuid || !status) {
    throw new Error('Unexpected security system status response');
  }

  return {
    uuid,
    status,
  };
}

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

  constructor(log: Logger, config: PlatformConfig, private readonly fetchClient: FetchClient = defaultFetchClient) {
    this.log = log;
    this.config = config;
    this.login = config['login'];
    this.password = config['password'];
  }

  private buildUrl(baseUrl: string, params: Record<string, string>): string {
    const query = new URLSearchParams({
      LoginName: this.login,
      Password: this.password,
      ...params,
    });

    return `${baseUrl}?${query.toString()}`;
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
    const url = this.buildUrl('https://webehome.com/API/WebAPI.aspx', {
      Function: 'GetSubUnitStatus',
    });
    const options = {
      headers: {
        'User-Agent': 'request',
      },
    };

    // Save the promise so other calls can use it
    this.fetching = this.fetchData(url, options).finally(() => {
      this.fetching = null;
    });

    return this.fetching;
  }


  private async fetchData(url: string, options: object): Promise<string | null> {
    const response = await this.fetchClient(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.text();

    this.lastFetched = Date.now();
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

    const url = this.buildUrl('https://webehome.com/Public/login.aspx', {
      Action: 'statusdetailed',
      ActionOnly: 'yes',
    });
    const options = {
      headers: {
        'User-Agent': 'request',
      },
    };

    const response = await this.fetchClient(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.text();

    const result = parseSecuritySystemStatus(data);

    this.securitySystemCache = result;
    this.securitySystemLastFetched = Date.now();

    return this.securitySystemCache;
  }

  async setSecuritySystemTargetState(action: string): Promise<void> {
    this.log.info('Invoking action', action);

    const url = this.buildUrl('https://webehome.com/Public/login.aspx', {
      Action: action,
      ActionOnly: 'yes',
    });

    const response = await this.fetchClient(url, { method: 'POST' });

    if (!response.ok) {
      throw new Error(`Failed to set state. Server responded with ${response.status}`);
    }
  }
}
