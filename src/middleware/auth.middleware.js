const jwt = require('jsonwebtoken');
const User = require('../models/User');

function auth(requiredRole) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const [, token] = header.split(' ');

      if (!token) {
        return res.status(401).json({ message: 'Authorization token missing' });
      }

      const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev-access-secret';
      const payload = jwt.verify(token, secret);

      const user = await User.findById(payload.id);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: 'User not active' });
      }

      if (requiredRole && user.role !== requiredRole) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      req.user = { id: user._id, email: user.email, role: user.role };
      next();
    } catch (err) {
      console.error('Auth middleware error:', err.message);
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
  };
}

module.exports = { auth };

