require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
async function run() {
  await connectDB();

  // Use a temporary test collection to avoid interfering with existing data
  const testCollection = `bookingstest_${Date.now()}`;

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

  // same index used by production
  bookingSchema.index({ showId: 1, seats: 1 }, { unique: true, partialFilterExpression: { bookingStatus: 'CONFIRMED' } });

  const BookingTest = mongoose.model(`BookingTest_${Date.now()}`, bookingSchema, testCollection);

  const showId = new mongoose.Types.ObjectId();
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();
  const seats = ['R1S10', 'R1S11'];

  console.log('Starting concurrent booking test (collection:', testCollection, ')');

  // Ensure indexes are created before running concurrent inserts
  await BookingTest.init();

  const createFor = (userId) =>
    BookingTest.create({
      userId,
      showId,
      movieId: new mongoose.Types.ObjectId(),
      seats,
      totalAmount: 100,
      bookingStatus: 'CONFIRMED',
      paymentStatus: 'PENDING',
      bookingSource: 'WEB',
    });

  const p1 = createFor(userA);
  const p2 = createFor(userB);

  const results = await Promise.allSettled([p1, p2]);

  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') console.log(`Request ${idx + 1} succeeded, id=`, r.value._id.toString());
    else console.log(`Request ${idx + 1} failed:`, r.reason.message || r.reason);
  });

  const created = await BookingTest.find({ showId });
  console.log('Total bookings created for show:', created.length);
  created.forEach((b) => console.log(' -', b._id.toString(), b.userId.toString(), b.seats));

  // Cleanup
  await mongoose.connection.dropCollection(testCollection).catch(() => {});
  mongoose.disconnect();
}

run().catch((e) => {
  console.error('Test error:', e);
  mongoose.disconnect();
});
