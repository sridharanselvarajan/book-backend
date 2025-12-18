const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { connectDB } = require('./config/db');
const User = require('./models/User');
const authRoutes = require('./routes/auth.routes');
const movieRoutes = require('./routes/movie.routes');
const showRoutes = require('./routes/show.routes');
const bookingRoutes = require('./routes/booking.routes');
const paymentRoutes = require('./routes/payment.routes');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// simple show-based rooms for seat updates
io.on('connection', (socket) => {
  socket.on('joinShow', (showId) => {
    socket.join(`show:${showId}`);
  });
  socket.on('leaveShow', (showId) => {
    socket.leave(`show:${showId}`);
  });
});

app.set('io', io);
const PORT = process.env.PORT || 5000;

// middlewares
app.use(
  cors({
    origin: ['http://localhost:5173','https://book-frontend-dvln.vercel.app'],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// health check
app.get('/', (req, res) => {
  res.json({ message: 'Backend is running for BookMyShow-like app 🚀' });
});

// routes
app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/shows', showRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/health', require('./routes/health.routes'));

// health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// error handling middleware (must be last)
const errorHandler = require('./middleware/errorHandler.middleware');
app.use(errorHandler);

// Create admin user if it doesn't exist
async function ensureAdminUser() {
  try {
    const adminEmail = 'admin@bookmyshow.com';
    const adminPassword = 'admin123';
    
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      admin = await User.create({
        name: 'Admin User',
        email: adminEmail,
        password: hashedPassword,
        role: 'ADMIN',
        phone: '+1234567890',
      });
      console.log('✅ Admin user created:', admin.email);
    } else {
      // Ensure existing admin has correct role
      if (admin.role !== 'ADMIN') {
        admin.role = 'ADMIN';
        await admin.save();
        console.log('✅ Admin user role updated');
      } else {
        console.log('ℹ️  Admin user already exists');
      }
    }
  } catch (err) {
    console.error('❌ Error ensuring admin user:', err.message);
  }
}

// start server after DB connection
connectDB().then(async () => {
  await ensureAdminUser();
  server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`Admin login: admin@bookmyshow.com / admin123`);
  });
});

