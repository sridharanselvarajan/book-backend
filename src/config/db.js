const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;

  try {
    await mongoose.connect(uri, {
      autoIndex: true,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
}

module.exports = { connectDB };


