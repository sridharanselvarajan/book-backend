const express = require('express');
const Movie = require('../models/Movie');
const Show = require('../models/Show');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { auth } = require('../middleware/auth.middleware');
const { getRedisClient } = require('../config/redis');

const router = express.Router();
const redis = getRedisClient();

// All admin routes require ADMIN role
router.use(auth('ADMIN'));

// GET /api/admin/dashboard - stats
router.get('/dashboard', async (req, res) => {
  try {
    const [totalMovies, totalShows, totalBookings, totalUsers] = await Promise.all([
      Movie.countDocuments({ isActive: true }),
      Show.countDocuments({ isActive: true }),
      Booking.countDocuments(),
      User.countDocuments({ isActive: true }),
    ]);

    const recentBookings = await Booking.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'name email')
      .populate('movieId', 'title')
      .populate('showId', 'theatreName city showTime');

    return res.json({
      stats: { totalMovies, totalShows, totalBookings, totalUsers },
      recentBookings,
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Movie management
router.get('/movies', async (req, res) => {
  try {
    const movies = await Movie.find().sort({ createdAt: -1 });
    return res.json({ data: movies });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/movies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const movie = await Movie.findByIdAndUpdate(id, updates, { new: true });
    if (!movie) return res.status(404).json({ message: 'Movie not found' });

    // Invalidate cache
    try {
      await redis.del('movies:all');
      await redis.del(`movies:${id}`);
    } catch (e) {
      console.warn('Cache invalidation failed:', e.message);
    }

    return res.json({ message: 'Movie updated', data: movie });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/movies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const movie = await Movie.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!movie) return res.status(404).json({ message: 'Movie not found' });

    try {
      await redis.del('movies:all');
      await redis.del(`movies:${id}`);
    } catch (e) {
      console.warn('Cache invalidation failed:', e.message);
    }

    return res.json({ message: 'Movie deactivated', data: movie });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Show management
router.get('/shows', async (req, res) => {
  try {
    const shows = await Show.find()
      .populate('movieId', 'title')
      .sort({ createdAt: -1 });
    return res.json({ data: shows });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/shows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const show = await Show.findByIdAndUpdate(id, updates, { new: true }).populate('movieId');
    if (!show) return res.status(404).json({ message: 'Show not found' });

    // Invalidate show caches
    try {
      const pattern = `shows:${show.movieId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(keys);
    } catch (e) {
      console.warn('Cache invalidation failed:', e.message);
    }

    return res.json({ message: 'Show updated', data: show });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/shows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const show = await Show.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!show) return res.status(404).json({ message: 'Show not found' });

    try {
      const pattern = `shows:${show.movieId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(keys);
    } catch (e) {
      console.warn('Cache invalidation failed:', e.message);
    }

    return res.json({ message: 'Show deactivated', data: show });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Booking management
router.get('/bookings', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const bookings = await Booking.find()
      .populate('userId', 'name email')
      .populate('movieId', 'title')
      .populate('showId', 'theatreName city showTime')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Booking.countDocuments();
    return res.json({ data: bookings, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// User management
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    return res.json({ data: users });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { role, isActive } = req.body;
    const updates = {};
    if (role) updates.role = role;
    if (typeof isActive === 'boolean') updates.isActive = isActive;

    const user = await User.findByIdAndUpdate(id, updates, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({ message: 'User updated', data: user });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

