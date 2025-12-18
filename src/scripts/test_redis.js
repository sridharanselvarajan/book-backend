require('dotenv').config();
const { getRedisClient } = require('../config/redis');

(async () => {
  const redis = getRedisClient();
  try {
    if (typeof redis.ping === 'function') {
      const pong = await redis.ping();
      console.log('PING:', pong);
    } else {
      console.log('PING: not supported by in-memory client');
    }

    if (typeof redis.set === 'function') {
      await redis.set('bms:test', 'ok', 'EX', 60);
      const v = await redis.get('bms:test');
      console.log('GET bms:test =>', v);
    }

    if (typeof redis.keys === 'function') {
      const keys = await redis.keys('bms:*');
      console.log('KEYS bms:* =>', keys.slice(0, 50));
    }

    if (typeof redis.pttl === 'function') {
      const ttl = await redis.pttl('bms:test');
      console.log('PTTL bms:test =>', ttl);
    } else if (typeof redis.ttl === 'function') {
      const t = await redis.ttl('bms:test');
      console.log('TTL bms:test =>', t);
    }

    // cleanup
    if (typeof redis.del === 'function') {
      await redis.del('bms:test');
    }

    console.log('Redis test completed');
  } catch (err) {
    console.error('Redis test error:', err);
  } finally {
    try {
      if (redis && typeof redis.disconnect === 'function') redis.disconnect();
    } catch (e) {
      // ignore
    }
    process.exit(0);
  }
})();
