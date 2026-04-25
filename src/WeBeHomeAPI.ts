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

export type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type FetchClient = (url: string, options?: FetchOptions) => Promise<FetchResponse>;

const defaultFetchClient: FetchClient = (url, options) => fetch(url, options);

type RequestKind = 'sensor' | 'security status' | 'security action';

type RequestState = {
  failureCount: number;
  backoffUntil: number;
};

const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;

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
  private login: string;
  private password: string;

  private fetching: Promise<string | null> | null = null;
  private securitySystemFetching: Promise<SecuritySystemData> | null = null;

  private readonly throttleTime = 5000; // 5000 milliseconds = 5 seconds
  private readonly requestTimeoutMs: number;
  private readonly backoffAfterFailures = 2;
  private readonly initialBackoffMs = 10_000;
  private readonly maxBackoffMs = 120_000;
  private lastFetched = 0;
  private cache: string | null = null;
  private securitySystemLastFetched = 0;
  private securitySystemCache: SecuritySystemData | null = null;
  private readonly requestStates: Record<Exclude<RequestKind, 'security action'>, RequestState> = {
    sensor: {
      failureCount: 0,
      backoffUntil: 0,
    },
    'security status': {
      failureCount: 0,
      backoffUntil: 0,
    },
  };

  constructor(log: Logger, config: PlatformConfig, private readonly fetchClient: FetchClient = defaultFetchClient) {
    this.log = log;
    this.login = config['login'];
    this.password = config['password'];
    this.requestTimeoutMs = this.parseBoundedNumber(config['requestTimeoutMs'], 15_000,
      MIN_REQUEST_TIMEOUT_MS, MAX_REQUEST_TIMEOUT_MS);
  }

  private buildUrl(baseUrl: string, params: Record<string, string>): string {
    const query = new URLSearchParams({
      LoginName: this.login,
      Password: this.password,
      ...params,
    });

    return `${baseUrl}?${query.toString()}`;
  }

  async fetchStatus(forceRefresh = false): Promise<string | null> {
    const now = Date.now();

    // If it's been less than 5 seconds since the last fetch, return the cached data
    if (!forceRefresh && now - this.lastFetched < this.throttleTime && this.cache !== null) {
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
    this.fetching = this.fetchData(url, options, 'sensor').finally(() => {
      this.fetching = null;
    });

    return this.fetching;
  }


  private async fetchData(url: string, options: FetchOptions, requestKind: RequestKind): Promise<string | null> {
    const data = await this.fetchText(url, options, requestKind);

    this.lastFetched = Date.now();
    return this.cache = data;
  }

  async fetchSecuritySystemStatus(forceRefresh = false): Promise<SecuritySystemData> {
    const now = Date.now();

    if (!forceRefresh && now - this.securitySystemLastFetched < this.throttleTime && this.securitySystemCache !== null) {
      // If it's been less than 5 seconds since the last fetch, return the cached data
    //   this.log.debug('Returning cached sensor status');
      return this.securitySystemCache;
    }

    if (this.securitySystemFetching) {
      return this.securitySystemFetching;
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

    this.securitySystemFetching = this.fetchSecuritySystemData(url, options).finally(() => {
      this.securitySystemFetching = null;
    });

    return this.securitySystemFetching;
  }

  private async fetchSecuritySystemData(url: string, options: FetchOptions): Promise<SecuritySystemData> {
    const data = await this.fetchText(url, options, 'security status');

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

    await this.fetchText(url, { method: 'POST' }, 'security action');

    this.securitySystemCache = null;
    this.securitySystemLastFetched = 0;
  }

  private async fetchText(url: string, options: FetchOptions, requestKind: RequestKind): Promise<string> {
    const useBackoff = requestKind !== 'security action';
    if (useBackoff) {
      this.throwIfBackedOff(requestKind);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      const response = await this.fetchClient(url, {
        ...options,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.text();
      if (useBackoff) {
        this.recordSuccess(requestKind);
      }
      return data;
    } catch (error) {
      if (useBackoff) {
        this.recordFailure(requestKind);
      }
      throw this.sanitizeRequestError(error, requestKind, timedOut);
    } finally {
      clearTimeout(timeout);
    }
  }

  private throwIfBackedOff(requestKind: Exclude<RequestKind, 'security action'>) {
    const state = this.requestStates[requestKind];
    const now = Date.now();

    if (now < state.backoffUntil) {
      const remainingSeconds = Math.ceil((state.backoffUntil - now) / 1000);
      throw new Error(`Skipping WeBeHome ${requestKind} request during backoff (${remainingSeconds}s remaining)`);
    }
  }

  private recordSuccess(requestKind: Exclude<RequestKind, 'security action'>) {
    const state = this.requestStates[requestKind];
    if (state.failureCount > 0) {
      this.log.debug(`WeBeHome ${requestKind} request recovered after`, state.failureCount, 'failure(s)');
    }

    state.failureCount = 0;
    state.backoffUntil = 0;
  }

  private recordFailure(requestKind: Exclude<RequestKind, 'security action'>) {
    const state = this.requestStates[requestKind];
    state.failureCount++;

    if (state.failureCount < this.backoffAfterFailures) {
      return;
    }

    const backoffMs = Math.min(
      this.maxBackoffMs,
      this.initialBackoffMs * (2 ** (state.failureCount - this.backoffAfterFailures)),
    );
    state.backoffUntil = Date.now() + backoffMs;
    this.log.warn(`WeBeHome ${requestKind} request failed`, state.failureCount,
      `times; backing off for ${Math.ceil(backoffMs / 1000)} seconds`);
  }

  private sanitizeRequestError(error: unknown, requestKind: RequestKind, timedOut: boolean): Error {
    if (timedOut) {
      return new Error(`WeBeHome ${requestKind} request timed out after ${this.requestTimeoutMs}ms`);
    }

    if (error instanceof Error && error.message.startsWith('HTTP error! Status:')) {
      return error;
    }

    return new Error(`WeBeHome ${requestKind} request failed`);
  }

  private parseBoundedNumber(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
    const parsedValue = typeof value === 'number' ? value : Number.parseInt(String(value), 10);

    if (!Number.isFinite(parsedValue)) {
      return defaultValue;
    }

    return Math.min(Math.max(parsedValue, minimum), maximum);
  }
}
