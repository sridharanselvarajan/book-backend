const express = require('express');
const Show = require('../models/Show');
const { auth } = require('../middleware/auth.middleware');
const { getRedisClient } = require('../config/redis');

const router = express.Router();
const redis = getRedisClient();

const SHOWS_TTL_SECONDS = 60;
const SEAT_LOCK_TTL_SECONDS = 5 * 60; // 5 minutes
const LOCK_RATE_LIMIT_TTL = 60; // seconds
const LOCK_RATE_LIMIT_MAX = 20; // max lock requests per user per minute

function getShowsCacheKey(movieId, city) {
  const cityKey = city ? city.toLowerCase() : 'all';
  return `shows:${movieId}:${cityKey}`;
}

function getSeatKey(showId, seatId) {
  return `seatlock:${showId}:${seatId}`;
}

// GET /api/shows/:movieId?city=chennai
router.get('/:movieId', async (req, res) => {
  try {
    const { movieId } = req.params;
    const { city } = req.query;
    const cacheKey = getShowsCacheKey(movieId, city);

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({ fromCache: true, data: JSON.parse(cached) });
      }
    } catch (cacheErr) {
      console.warn('Shows cache read failed:', cacheErr.message);
    }

    const query = { movieId, isActive: true };
    if (city) {
      query.city = city;
    }

    const shows = await Show.find(query).sort({ showTime: 1 });

    try {
      await redis.set(cacheKey, JSON.stringify(shows), 'EX', SHOWS_TTL_SECONDS);
    } catch (cacheErr) {
      console.warn('Shows cache write failed:', cacheErr.message);
    }

    return res.json({ fromCache: false, data: shows });
  } catch (err) {
    console.error('Get shows error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/shows - admin only (for seeding)
router.post('/', auth('ADMIN'), async (req, res) => {
  try {
    const { movieId, theatreName, city, screen, showTime, totalSeats, seatLayout, basePrice } =
      req.body;

    if (!movieId || !theatreName || !city || !showTime || !totalSeats || !basePrice) {
      return res.status(400).json({ message: 'Required fields missing' });
    }

    const show = await Show.create({
      movieId,
      theatreName,
      city,
      screen,
      showTime,
      totalSeats,
      seatLayout,
      basePrice,
    });

    // Invalidate any caches for that movie (all cities)
    try {
      const pattern = `shows:${movieId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length) {
        await redis.del(keys);
      }
    } catch (cacheErr) {
      console.warn('Shows cache invalidation failed:', cacheErr.message);
    }

    return res.status(201).json({ message: 'Show created', data: show });
  } catch (err) {
    console.error('Create show error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/shows/:showId/seats - seat layout + lock info
router.get('/:showId/seats', async (req, res) => {
  try {
    const { showId } = req.params;
    const show = await Show.findById(showId);
    if (!show || !show.isActive) {
      return res.status(404).json({ message: 'Show not found' });
    }

    // Build base seats from seatLayout
    const seats = (show.seatLayout || []).map((seat) => {
      const seatId = `${seat.row}-${seat.number}`;
      return {
        seatId,
        row: seat.row,
        number: seat.number,
        type: seat.type,
      };
    });

    // If no explicit layout, generate a simple demo layout
    if (!seats.length) {
      const rows = ['A', 'B', 'C', 'D', 'E'];
      const perRow = Math.min(show.totalSeats / rows.length, 12) || 10;
      rows.forEach((row) => {
        for (let n = 1; n <= perRow; n += 1) {
          const seatId = `${row}-${n}`;
          seats.push({ seatId, row, number: n, type: 'REGULAR' });
        }
      });
    }

    // Attach lock info from cache
    const pattern = `seatlock:${showId}:`;
    const keys = await redis.keys(`${pattern}*`);
    const lockedMap = {};

    if (keys.length) {
      const values = await Promise.all(keys.map((k) => redis.get(k)));
      keys.forEach((key, idx) => {
        const val = values[idx];
        if (!val) return;
        try {
          const parsed = JSON.parse(val);
          const seatId = key.split(':').slice(2).join(':');
          lockedMap[seatId] = parsed;
        } catch {
          // ignore bad data
        }
      });
    }

    const userId = (req.user && req.user.id) || null;

    const seatsWithLock = seats.map((s) => {
      const lock = lockedMap[s.seatId];
      const isLocked = !!lock;
      const lockedByUser = isLocked && userId && String(lock.userId) === String(userId);
      return { ...s, isLocked, lockedByUser };
    });

    return res.json({
      show: {
        id: show._id,
        movieId: show.movieId,
        theatreName: show.theatreName,
        city: show.city,
        screen: show.screen,
        showTime: show.showTime,
        basePrice: show.basePrice,
      },
      seats: seatsWithLock,
    });
  } catch (err) {
    console.error('Get seats error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/shows/:showId/lock-seats - lock seats for current user
router.post('/:showId/lock-seats', auth(), async (req, res) => {
  try {
    const { showId } = req.params;
    const { seats } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(seats) || seats.length === 0) {
      return res.status(400).json({ message: 'Seats array is required' });
    }

    // rate limit: per-user per-show
    const rateKey = `ratelimit:lock:${userId}:${showId}`;
    const count = await redis.incr(rateKey);
    if (count === 1) {
      await redis.expire(rateKey, LOCK_RATE_LIMIT_TTL);
    }
    if (count > LOCK_RATE_LIMIT_MAX) {
      return res.status(429).json({ message: 'Too many seat lock attempts. Please slow down.' });
    }

    const show = await Show.findById(showId);
    if (!show || !show.isActive) {
      return res.status(404).json({ message: 'Show not found' });
    }

    // Attempt an atomic multi-seat lock when Redis supports eval (real Redis client)
    const now = new Date().toISOString();
    const payload = JSON.stringify({ userId, lockedAt: now });
    const keys = seats.map((s) => getSeatKey(showId, s));

    // Lua script: return list of conflicting keys if any exist, otherwise set all keys with EX
    const lua = `
      local conflicts = {}
      for i, k in ipairs(KEYS) do
        if redis.call('exists', k) == 1 then
          table.insert(conflicts, k)
        end
      end
      if #conflicts > 0 then
        return conflicts
      end
      for i, k in ipairs(KEYS) do
        redis.call('set', k, ARGV[1], 'EX', tonumber(ARGV[2]))
      end
      return {}
    `;

    let conflicts = [];
    if (typeof redis.eval === 'function') {
      try {
        const result = await redis.eval(lua, keys.length, ...keys, payload, String(SEAT_LOCK_TTL_SECONDS));
        // result is an array of conflicting keys or empty array
        if (Array.isArray(result) && result.length) {
          conflicts = result.map((k) => k.split(':').slice(2).join(':'));
        }
      } catch (e) {
        console.warn('Atomic seat lock failed, falling back:', e.message);
      }
    }

    // If Redis doesn't support eval (in-memory fallback) or lua failed, fallback to safe per-seat check
    if (!conflicts.length && typeof redis.eval !== 'function') {
      for (const seatId of seats) {
        const key = getSeatKey(showId, seatId);
        const existingRaw = await redis.get(key);
        if (existingRaw) {
          try {
            const existing = JSON.parse(existingRaw);
            if (String(existing.userId) !== String(userId)) {
              conflicts.push(seatId);
            }
          } catch {
            conflicts.push(seatId);
          }
        }
      }

      if (!conflicts.length) {
        for (const seatId of seats) {
          const key = getSeatKey(showId, seatId);
          await redis.set(key, JSON.stringify({ userId, lockedAt: now }), 'EX', SEAT_LOCK_TTL_SECONDS);
        }
      }
    }

    // broadcast update to all clients watching this show
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`show:${showId}`).emit('seatsLocked', {
          showId,
          seats,
          userId,
        });
      }
    } catch (e) {
      console.warn('Broadcast seatsLocked failed:', e.message);
    }

    return conflicts.length
      ? res.status(409).json({ message: 'Some seats are already locked by other users', conflicts })
      : res.json({ message: 'Seats locked successfully', lockedSeats: seats, lockExpiresInSeconds: SEAT_LOCK_TTL_SECONDS });
  } catch (err) {
    console.error('Lock seats error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

