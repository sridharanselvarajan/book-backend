const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, enum: ['CARD', 'UPI', 'NETBANKING', 'WALLET'] },
    transactionId: { type: String },
    paymentStatus: { type: String, enum: ['SUCCESS', 'FAILED'], required: true },
    failureReason: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('Payment', paymentSchema);


