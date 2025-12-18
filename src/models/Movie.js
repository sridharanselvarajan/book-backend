const mongoose = require('mongoose');

const movieSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String },
    genre: [{ type: String }],
    duration: { type: Number }, // in minutes
    language: { type: String },
    releaseDate: { type: Date },
    rating: { type: Number, min: 0, max: 10 },
    posterUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Movie', movieSchema);


