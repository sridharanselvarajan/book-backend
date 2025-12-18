const express = require('express');
const Booking = require('../models/Booking');
const Movie = require('../models/Movie');
const Show = require('../models/Show');
const { auth } = require('../middleware/auth.middleware');
const { getRedisClient } = require('../config/redis');

const router = express.Router();
const redis = getRedisClient();
const BOOKING_RATE_LIMIT_TTL = 60;
const BOOKING_RATE_LIMIT_MAX = 10;

function getSeatKey(showId, seatId) {
  return `seatlock:${showId}:${seatId}`;
}

// POST /api/bookings - create booking after validating seat locks
router.post('/', auth(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { showId, movieId, seats } = req.body;

    if (!showId || !movieId || !Array.isArray(seats) || !seats.length) {
      return res.status(400).json({ message: 'showId, movieId and seats are required' });
    }

    const rateKey = `ratelimit:booking:${userId}`;
    const count = await redis.incr(rateKey);
    if (count === 1) {
      await redis.expire(rateKey, BOOKING_RATE_LIMIT_TTL);
    }
    if (count > BOOKING_RATE_LIMIT_MAX) {
      return res.status(429).json({ message: 'Too many bookings. Please slow down.' });
    }

    const show = await Show.findById(showId);
    if (!show || !show.isActive) {
      return res.status(404).json({ message: 'Show not found' });
    }

    const movie = await Movie.findById(movieId);
    if (!movie || !movie.isActive) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    // Validate locks: all seats must be locked by this user
    const invalidSeats = [];
    for (const seatId of seats) {
      const key = getSeatKey(showId, seatId);
      const raw = await redis.get(key);
      if (!raw) {
        invalidSeats.push(seatId);
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        if (String(parsed.userId) !== String(userId)) {
          invalidSeats.push(seatId);
        }
      } catch {
        invalidSeats.push(seatId);
      }
    }

    if (invalidSeats.length) {
      return res.status(409).json({
        message: 'Some seats are not locked by this user or lock expired',
        invalidSeats,
      });
    }

    const totalAmount = (show.basePrice || 0) * seats.length;

    let booking;
    try {
      booking = await Booking.create({
        userId,
        showId,
        movieId,
        seats,
        totalAmount,
        bookingStatus: 'CONFIRMED',
        paymentStatus: 'PENDING',
        bookingSource: 'WEB',
      });
    } catch (createErr) {
      // Duplicate key error from Mongo indicates overlapping seat(s) were
      // booked concurrently. Return 409 with the conflicting seats.
      if (createErr && createErr.code === 11000) {
        try {
          const conflicting = await Booking.find({
            showId,
            seats: { $in: seats },
            bookingStatus: { $ne: 'CANCELLED' },
          }).select('seats -_id');
          const occupied = new Set();
          conflicting.forEach((doc) => doc.seats.forEach((s) => occupied.add(s)));
          const invalidSeats = seats.filter((s) => occupied.has(s));
          return res.status(409).json({
            message: 'Some seats were already booked by others',
            invalidSeats,
          });
        } catch (qErr) {
          console.error('Error querying conflicting bookings:', qErr);
          return res.status(409).json({ message: 'Some seats were already booked' });
        }
      }
      throw createErr;
    }

    // On successful booking creation: clear the seat locks and broadcast
    // to connected clients so they can mark seats as booked.
    try {
      for (const seatId of seats) {
        const key = getSeatKey(showId, seatId);
        await redis.del(key);
      }

      const io = req.app.get('io');
      if (io) {
        io.to(`show:${showId}`).emit('seatsBooked', { showId, seats });
      }
    } catch (e) {
      console.warn('Failed to clear locks or broadcast after booking:', e.message);
    }

    return res.status(201).json({
      message: 'Booking created (pending payment)',
      booking,
    });
  } catch (err) {
    console.error('Create booking error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/bookings - user's own bookings
router.get('/', auth(), async (req, res) => {
  try {
    const userId = req.user.id;
    const bookings = await Booking.find({ userId })
      .populate('movieId', 'title posterUrl')
      .populate('showId', 'theatreName city showTime')
      .sort({ createdAt: -1 });

    return res.json({ data: bookings });
  } catch (err) {
    console.error('Get bookings error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/bookings/:id - single booking
router.get('/:id', auth(), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const booking = await Booking.findOne({ _id: id, userId })
      .populate('movieId', 'title posterUrl')
      .populate('showId', 'theatreName city showTime screen');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    return res.json({ data: booking });
  } catch (err) {
    console.error('Get booking error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/bookings/:id/cancel - cancel booking
router.put('/:id/cancel', auth(), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const booking = await Booking.findOne({ _id: id, userId });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.bookingStatus === 'CANCELLED') {
      return res.status(400).json({ message: 'Booking already cancelled' });
    }

    if (booking.paymentStatus === 'SUCCESS') {
      return res.status(400).json({ message: 'Cannot cancel paid booking' });
    }

    booking.bookingStatus = 'CANCELLED';
    booking.cancelledAt = new Date();
    await booking.save();

    // Clear seat locks for this booking
    try {
      for (const seatId of booking.seats) {
        const key = getSeatKey(booking.showId, seatId);
        await redis.del(key);
      }

      // Broadcast unlock
      const io = req.app.get('io');
      if (io) {
        io.to(`show:${booking.showId}`).emit('seatsClearedAfterPayment', {
          showId: booking.showId,
        });
      }
    } catch (e) {
      console.warn('Failed to clear locks on cancel:', e.message);
    }

    return res.json({ message: 'Booking cancelled', data: booking });
  } catch (err) {
    console.error('Cancel booking error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


