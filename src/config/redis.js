const Redis = require('ioredis');

// internal client reference that may be either a real Redis client or an in-memory fallback
let clientInternal = null;
let usingRealRedis = false;

// Simple in-memory fallback that mimics a tiny subset of Redis API
function createInMemoryClient() {
  console.warn('⚠️  Using in-memory cache instead of real Redis (DEV only).');
  const store = new Map();
  const ttlTimers = new Map();

  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      const { value, expiresAt } = entry;
      if (expiresAt && Date.now() > expiresAt) {
        store.delete(key);
        return null;
      }
      return value;
    },
    async set(key, value, mode, ttlSeconds) {
      let expiresAt = null;
      if (mode === 'EX' && typeof ttlSeconds === 'number') {
        expiresAt = Date.now() + ttlSeconds * 1000;
      }
      store.set(key, { value, expiresAt });
      if (ttlSeconds && ttlSeconds > 0) {
        if (ttlTimers.has(key)) clearTimeout(ttlTimers.get(key));
        const t = setTimeout(() => {
          store.delete(key);
          ttlTimers.delete(key);
        }, ttlSeconds * 1000);
        ttlTimers.set(key, t);
      }
    },
    async del(keys) {
      if (Array.isArray(keys)) keys.forEach((k) => store.delete(k));
      else store.delete(keys);
    },
    async keys(pattern) {
      if (!pattern.includes('*')) return store.has(pattern) ? [pattern] : [];
      const prefix = pattern.split('*')[0];
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    },
    async incr(key) {
      const current = Number(store.get(key) || '0');
      const next = current + 1;
      store.set(key, String(next));
      return next;
    },
    async expire(key, ttlSeconds) {
      if (!store.has(key)) return 0;
      const expiresAt = Date.now() + ttlSeconds * 1000;
      const entry = store.get(key) || {};
      entry.expiresAt = expiresAt;
      store.set(key, entry);
      if (ttlTimers.has(key)) clearTimeout(ttlTimers.get(key));
      const t = setTimeout(() => {
        store.delete(key);
        ttlTimers.delete(key);
      }, ttlSeconds * 1000);
      ttlTimers.set(key, t);
      return 1;
    },
    async pttl(key) {
      const entry = store.get(key);
      if (!entry || !entry.expiresAt) return -1;
      return Math.max(0, entry.expiresAt - Date.now());
    },
    disconnect() {
      ttlTimers.forEach((t) => clearTimeout(t));
      ttlTimers.clear();
      store.clear();
    },
  };
}

function createIoredisClient(url) {
  // keep retries & timeout small so failures surface quickly in development
  const opts = { maxRetriesPerRequest: 2, connectTimeout: 3000 };
  const r = new Redis(url, opts);

  r.on('connect', () => {
    console.log('✅ Redis connected');
    usingRealRedis = true;
  });

  r.on('error', (err) => {
    console.error('Redis error:', err.message);
    // swap to in-memory fallback on connection failures
    try { r.disconnect(); } catch (e) {}
    // leave clientInternal as in-memory; we swap to in-memory at startup to avoid race errors
    console.warn('Redis connection error — will continue using in-memory fallback');
  });

  return r;
}

// A small proxy that always delegates to the current `clientInternal` implementation.
// This allows swapping clientInternal between a real Redis client and the in-memory fallback
// without changing references held by other modules.
const proxy = {
  async get(...args) {
    if (!clientInternal || typeof clientInternal.get !== 'function') return null;
    return clientInternal.get(...args);
  },
  async set(...args) {
    if (!clientInternal || typeof clientInternal.set !== 'function') return null;
    return clientInternal.set(...args);
  },
  async del(...args) {
    if (!clientInternal || typeof clientInternal.del !== 'function') return null;
    return clientInternal.del(...args);
  },
  async keys(...args) {
    if (!clientInternal || typeof clientInternal.keys !== 'function') return [];
    return clientInternal.keys(...args);
  },
  async incr(...args) {
    if (!clientInternal || typeof clientInternal.incr !== 'function') return null;
    return clientInternal.incr(...args);
  },
  async expire(...args) {
    if (!clientInternal || typeof clientInternal.expire !== 'function') return null;
    return clientInternal.expire(...args);
  },
  async pttl(...args) {
    if (!clientInternal) return -1;
    if (typeof clientInternal.pttl === 'function') return clientInternal.pttl(...args);
    if (typeof clientInternal.ttl === 'function') return clientInternal.ttl(...args);
    return -1;
  },
  async ttl(...args) {
    if (!clientInternal) return -1;
    if (typeof clientInternal.ttl === 'function') return clientInternal.ttl(...args);
    return -1;
  },
  async ping(...args) {
    if (!clientInternal || typeof clientInternal.ping !== 'function') return null;
    return clientInternal.ping(...args);
  },
  disconnect() { if (clientInternal && typeof clientInternal.disconnect === 'function') return clientInternal.disconnect(); },
};

function getRedisClient() {
  if (clientInternal) return proxy;

  // Start with in-memory fallback immediately so calls don't race with remote connection attempts
  clientInternal = createInMemoryClient();

  if (!process.env.REDIS_URL) {
    return proxy;
  }

  try {
    // attempt to create a real ioredis client in the background; if it connects, swap to it
    const r = createIoredisClient(process.env.REDIS_URL);
    r.on('connect', () => {
      console.log('✅ Redis connected — switching to real Redis client');
      clientInternal = r;
      usingRealRedis = true;
    });
    return proxy;
  } catch (err) {
    console.warn('Failed to initialize Redis client, continuing with in-memory fallback:', err.message);
    return proxy;
  }
}

function isUsingRealRedis() {
  return !!usingRealRedis;
}

module.exports = { getRedisClient, isUsingRealRedis };


