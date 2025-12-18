const express = require('express');
const { auth } = require('../middleware/auth.middleware');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const { getRedisClient } = require('../config/redis');

const router = express.Router();
const redis = getRedisClient();

function getSeatKey(showId, seatId) {
  return `seatlock:${showId}:${seatId}`;
}

// POST /api/payments/mock - simulate payment success/failure
router.post('/mock', auth(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId, status, method = 'CARD', failureReason } = req.body;

    if (!bookingId || !status || !['SUCCESS', 'FAILED'].includes(status)) {
      return res
        .status(400)
        .json({ message: 'bookingId and valid status (SUCCESS/FAILED) are required' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (String(booking.userId) !== String(userId)) {
      return res.status(403).json({ message: 'Cannot pay for another user booking' });
    }

    if (booking.paymentStatus === 'SUCCESS') {
      return res.status(400).json({ message: 'Booking already paid' });
    }

    const payment = await Payment.create({
      bookingId: booking._id,
      userId,
      amount: booking.totalAmount,
      paymentMethod: method,
      transactionId: `MOCK-${Date.now()}`,
      paymentStatus: status,
      failureReason: status === 'FAILED' ? failureReason || 'Mock failure' : undefined,
      paidAt: status === 'SUCCESS' ? new Date() : undefined,
    });

    booking.paymentStatus = status;
    if (status === 'FAILED') {
      booking.bookingStatus = 'CANCELLED';
    }
    await booking.save();

    // On success, clear seat locks for this booking and broadcast
    if (status === 'SUCCESS') {
      try {
        const pattern = `seatlock:${booking.showId}:`;
        const keys = await redis.keys(`${pattern}*`);
        if (keys.length) {
          await redis.del(keys);
        }
        const io = req.app.get('io');
        if (io) {
          io.to(`show:${booking.showId}`).emit('seatsClearedAfterPayment', {
            showId: booking.showId,
          });
        }
      } catch (err) {
        console.warn('Failed to clear seat locks after payment:', err.message);
      }
    }

    return res.status(201).json({
      message: 'Mock payment processed',
      payment,
      booking,
    });
  } catch (err) {
    console.error('Mock payment error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


