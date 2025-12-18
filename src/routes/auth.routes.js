const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { auth } = require('../middleware/auth.middleware');

const router = express.Router();

// helpers to generate tokens
function generateAccessToken(user) {
  const payload = { id: user._id, email: user.email, role: user.role };
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev-access-secret';
  const expiresIn = process.env.ACCESS_TOKEN_EXPIRES || '15m';

  return jwt.sign(payload, secret, { expiresIn });
}

async function generateRefreshToken(user) {
  const payload = { id: user._id };
  const secret = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
  const expiresIn = process.env.REFRESH_TOKEN_EXPIRES || '7d';

  const token = jwt.sign(payload, secret, { expiresIn });

  const decoded = jwt.decode(token);
  const expiresAt = decoded && decoded.exp ? new Date(decoded.exp * 1000) : null;

  await RefreshToken.create({
    userId: user._id,
    token,
    expiresAt,
  });

  return token;
}

function setRefreshCookie(res, token) {
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: false, // set true behind HTTPS in production
    sameSite: 'lax',
    maxAge: maxAgeMs,
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashed,
      phone,
    });
    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);
    setRefreshCookie(res, refreshToken);

    return res.status(201).json({
      message: 'User registered successfully',
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    user.lastLogin = new Date();
    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);
    setRefreshCookie(res, refreshToken);

    return res.json({
      message: 'Login successful',
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const tokenFromCookie = req.cookies && req.cookies.refreshToken;
    const providedToken = tokenFromCookie || req.body.refreshToken;

    if (!providedToken) {
      return res.status(401).json({ message: 'Refresh token missing' });
    }

    const secret = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
    let payload;
    try {
      payload = jwt.verify(providedToken, secret);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const stored = await RefreshToken.findOne({
      token: providedToken,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!stored) {
      return res.status(401).json({ message: 'Refresh token not valid' });
    }

    const user = await User.findById(payload.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User not active' });
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await generateRefreshToken(user);

    stored.isRevoked = true;
    await stored.save();

    setRefreshCookie(res, newRefreshToken);

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    console.error('Refresh token error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const tokenFromCookie = req.cookies && req.cookies.refreshToken;
    const providedToken = tokenFromCookie || req.body.refreshToken;

    if (providedToken) {
      await RefreshToken.updateMany(
        { token: providedToken, isRevoked: false },
        { $set: { isRevoked: true } }
      );
    }

    res.clearCookie('refreshToken');
    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/auth/me (protected example)
router.get('/me', auth(), async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  return res.json({ user });
});

// PUT /api/auth/profile - update user profile
router.put('/profile', auth(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (phone !== undefined) updates.phone = phone;

    const user = await User.findByIdAndUpdate(userId, updates, { new: true }).select(
      '-password'
    );
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ message: 'Profile updated', user });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


