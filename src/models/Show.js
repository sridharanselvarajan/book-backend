const mongoose = require('mongoose');

const seatLayoutSchema = new mongoose.Schema(
  {
    row: String,
    number: Number,
    type: { type: String, default: 'REGULAR' }, // e.g., REGULAR, PREMIUM
  },
  { _id: false }
);

const showSchema = new mongoose.Schema(
  {
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
    theatreName: { type: String, required: true },
    city: { type: String, required: true },
    screen: { type: String },
    showTime: { type: Date, required: true },
    totalSeats: { type: Number, required: true },
    seatLayout: { type: [seatLayoutSchema], default: [] },
    basePrice: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Show', showSchema);


