const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    showId: { type: mongoose.Schema.Types.ObjectId, ref: 'Show', required: true },
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
    seats: [{ type: String, required: true }],
    totalAmount: { type: Number, required: true },
    bookingStatus: {
      type: String,
      enum: ['CONFIRMED', 'CANCELLED'],
      default: 'CONFIRMED',
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
      default: 'PENDING',
    },
    bookingSource: {
      type: String,
      enum: ['WEB', 'MOBILE'],
      default: 'WEB',
    },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

// Ensure no two non-cancelled bookings can contain the same seat for the same show.
// This creates a unique index on (showId, seats) but only for bookings where
// bookingStatus != 'CANCELLED'. It provides an atomic database-level guard
// against overlapping bookings across concurrent requests.
bookingSchema.index(
  { showId: 1, seats: 1 },
  { unique: true, partialFilterExpression: { bookingStatus: 'CONFIRMED' } }
);
module.exports = mongoose.model('Booking', bookingSchema);


