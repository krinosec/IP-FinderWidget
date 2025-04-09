/* utils.js – Revised */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

// Promisify callback-based functions for async/await.
Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

export const ApiService = {
  IP_INFO_IO: 0,
  IP_API_COM: 1,
};

const API_CONFIG = {
  [ApiService.IP_API_COM]: {
    url: GLib.getenv('IP_FINDER_FORCE_HTTPS')
      ? 'https://ip-api.com/json/'
      : 'http://ip-api.com/json/',
    // Official free API fields
    fields:
      'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query',
    rateLimit: 45,
    windowMs: 60000,
  },
  [ApiService.IP_INFO_IO]: {
    url: 'https://ipinfo.io/json',
    token: null, // Set your token here if needed.
    rateLimit: 1000,
    windowMs: 86400000,
  },
};

const REQUEST_CONFIG = {
  maxRetries: 3,
  baseBackoff: 1000,
  maxBackoff: 10000,
  timeout: 10000,
};

// Shared flag emoji function.
export function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return '🌐';
  }
  const codePoints = [...countryCode.toUpperCase()].map(
    (char) => 0x1F1E6 + char.charCodeAt(0) - 65
  );
  return String.fromCodePoint(...codePoints);
}

/* ------------------------- Metrics & Rate Limiter ------------------------- */

const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  retries: 0,
  rateLimitRejections: 0,
};

function sendAlert(message, meta = {}) {
  console.error(`[ALERT] ${message}`, meta);
}

function checkAlerts() {
  if (metrics.rateLimitRejections >= 10) {
    sendAlert('High number of rate limit rejections', { rateLimitRejections: metrics.rateLimitRejections });
    metrics.rateLimitRejections = 0;
  }
}

class TokenBucket {
  constructor(capacity, refillRate) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }
  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
  tryRemoveToken() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  getRemaining() {
    this.refill();
    return this.tokens;
  }
}

const rateLimits = new Map();

const log = (message, meta = {}, level = 'info') => {
  const prefix = `[IP-Finder] [${level.toUpperCase()}]`;
  console.log(prefix, message, JSON.stringify(meta));
};

const createQueryString = (params) =>
  Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

const checkRateLimit = (apiService) => {
  const config = API_CONFIG[apiService];
  if (!config.rateLimit) return true;

  const windowDuration = config.windowMs;
  const refillRate = config.rateLimit / windowDuration;
  if (!rateLimits.has(apiService)) {
    rateLimits.set(apiService, new TokenBucket(config.rateLimit, refillRate));
  }
  const bucket = rateLimits.get(apiService);
  const allowed = bucket.tryRemoveToken();
  log(`TokenBucket check: ${allowed ? 'Allowed' : 'Rejected'} request. ${bucket.getRemaining().toFixed(2)} tokens remaining of ${bucket.capacity}`, { apiService }, 'debug');
  if (!allowed) {
    metrics.rateLimitRejections++;
    checkAlerts();
  }
  return allowed;
};

/* ------------------------- API Request Function ------------------------- */

export async function getIPDetails(session, params, apiService, attempt = 1) {
  metrics.totalRequests++;
  const config = API_CONFIG[apiService];

  if (!checkRateLimit(apiService)) {
    log('API rate limit exceeded', { apiService }, 'warn');
    metrics.failedRequests++;
    return { error: 'API rate limit exceeded' };
  }

  const query = createQueryString({
    ...params,
    ...(apiService === ApiService.IP_API_COM ? { fields: config.fields } : {}),
    ...(apiService === ApiService.IP_INFO_IO && config.token ? { token: config.token } : {})
  });

  const url = `${config.url}?${query}`;
  const uri = Soup.URI.new_from_string(url);
  const message = new Soup.Message({ method: 'GET', uri: uri });
  message.request_headers.append('Accept', 'application/json');
  message.request_headers.append('User-Agent', 'GNOME-IP-Finder/1.0');

  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REQUEST_CONFIG.timeout, () => {
        session.abort();
        reject(new Error(`Request timed out after ${REQUEST_CONFIG.timeout}ms`));
        return GLib.SOURCE_REMOVE;
      });
    });

    const responsePromise = session.send_and_read_async(message, null);
    const response = await Promise.race([responsePromise, timeoutPromise]);

    const dataStr = new TextDecoder().decode(response.get_data());
    if (message.status_code !== 200) {
      throw new Error(`HTTP ${message.status_code}: ${dataStr.slice(0, 100)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(dataStr);
    } catch (e) {
      throw new Error('Failed to parse JSON response');
    }
    if (apiService === ApiService.IP_API_COM && parsed.status === 'fail') {
      throw new Error(parsed.message || 'API error');
    }
    log('API request succeeded', { apiService, url: url.split('?')[0] }, 'debug');
    metrics.successfulRequests++;
    return { data: parsed };
  } catch (error) {
    log('API request failed', { attempt, error: error.message, url: url.split('?')[0] }, 'error');
    metrics.failedRequests++;
    if ((error.message.includes('timed out') || error.message.startsWith('HTTP 5')) && attempt < REQUEST_CONFIG.maxRetries) {
      return retryRequest(session, params, apiService, attempt + 1);
    }
    return { error: error.message };
  } finally {
    if (timeoutId) {
      GLib.source_remove(timeoutId);
      timeoutId = null;
      log('Cleaned up timeout', { timeoutId });
    }
  }
}

async function retryRequest(session, params, apiService, attempt) {
  if (attempt > REQUEST_CONFIG.maxRetries) {
    return { error: 'Max retries exceeded' };
  }
  metrics.retries++;
  const delay = Math.min(
    REQUEST_CONFIG.baseBackoff * Math.pow(2, attempt - 1),
    REQUEST_CONFIG.maxBackoff
  );
  log('Retrying request', { apiService, attempt, delay }, 'info');
  await new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      resolve(true);
      return GLib.SOURCE_REMOVE;
    });
  });
  return getIPDetails(session, params, apiService, attempt);
}

/* ------------------------- Map Tile Functions ------------------------- */

export function getMapTileInfo(location, zoom) {
  // Expects location as "lat, lon"
  if (!location) {
    return { zoom, xTile: 0, yTile: 0 };
  }
  const parts = location.split(',');
  if (parts.length < 2) return { zoom, xTile: 0, yTile: 0 };
  const lat = parseFloat(parts[0].trim());
  const lon = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lon)) return { zoom, xTile: 0, yTile: 0 };
  const n = Math.pow(2, zoom);
  const xTile = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const yTile = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { zoom, xTile, yTile };
}

export async function getMapTile(session, soupParams, extensionPath, mapTileUrl) {
  // Build full URL to fetch the tile image.
  const fullUrl = `https://tile.openstreetmap.org/${mapTileUrl}.png`;
  const uri = Soup.URI.new_from_string(fullUrl);
  const message = new Soup.Message({ method: 'GET', uri: uri });
  message.request_headers.append('Accept', 'image/png');
  try {
    const response = await session.send_and_read_async(message, null);
    if (message.status_code !== 200) {
      return { error: `HTTP ${message.status_code}` };
    }
    // Save tile image as "latest_map.png" in the extension's icons folder.
    const latestMapPath = `${extensionPath}/icons/latest_map.png`;
    const file = Gio.File.new_for_path(latestMapPath);
    const writeResult = file.replace_contents(response.get_data(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    if (!writeResult) {
      return { error: 'Failed to write map tile to file.' };
    }
    return { file };
  } catch (error) {
    return { error: error.message };
  }
}
