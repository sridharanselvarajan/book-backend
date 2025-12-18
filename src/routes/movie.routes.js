const express = require('express');
const Movie = require('../models/Movie');
const { auth } = require('../middleware/auth.middleware');
const { getRedisClient } = require('../config/redis');

const router = express.Router();
const redis = getRedisClient();

const MOVIES_CACHE_KEY = 'movies:all';
const MOVIES_TTL_SECONDS = 60; // 1 minute demo TTL

// GET /api/movies - public, cached
router.get('/', async (req, res) => {
  try {
    // Try Redis cache first
    try {
      const cached = await redis.get(MOVIES_CACHE_KEY);
      if (cached) {
        return res.json({ fromCache: true, data: JSON.parse(cached) });
      }
    } catch (cacheErr) {
      console.warn('Movies cache read failed, falling back to DB:', cacheErr.message);
    }

    const movies = await Movie.find({ isActive: true }).sort({ releaseDate: -1 });

    try {
      await redis.set(MOVIES_CACHE_KEY, JSON.stringify(movies), 'EX', MOVIES_TTL_SECONDS);
    } catch (cacheErr) {
      console.warn('Movies cache write failed:', cacheErr.message);
    }

    return res.json({ fromCache: false, data: movies });
  } catch (err) {
    console.error('Get movies error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/movies/:id - public, optional individual cache
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `movies:${id}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({ fromCache: true, data: JSON.parse(cached) });
      }
    } catch (cacheErr) {
      console.warn('Movie detail cache read failed:', cacheErr.message);
    }

    const movie = await Movie.findById(id);
    if (!movie || !movie.isActive) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    try {
      await redis.set(cacheKey, JSON.stringify(movie), 'EX', MOVIES_TTL_SECONDS);
    } catch (cacheErr) {
      console.warn('Movie detail cache write failed:', cacheErr.message);
    }

    return res.json({ fromCache: false, data: movie });
  } catch (err) {
    console.error('Get movie by id error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/movies - admin only, also clears cache
router.post('/', auth('ADMIN'), async (req, res) => {
  try {
    const { title, description, genre, duration, language, releaseDate, rating, posterUrl } =
      req.body;

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const movie = await Movie.create({
      title,
      description,
      genre,
      duration,
      language,
      releaseDate,
      rating,
      posterUrl,
    });

    // Invalidate caches
    try {
      await redis.del(MOVIES_CACHE_KEY);
      await redis.del(`movies:${movie._id}`);
    } catch (cacheErr) {
      console.warn('Movies cache invalidation failed:', cacheErr.message);
    }

    return res.status(201).json({ message: 'Movie created', data: movie });
  } catch (err) {
    console.error('Create movie error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


