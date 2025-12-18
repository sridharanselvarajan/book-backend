const express = require('express');
const { isUsingRealRedis } = require('../config/redis');

const router = express.Router();

// GET /api/health/redis
router.get('/redis', (req, res) => {
  try {
    const usingRedis = isUsingRealRedis();
    return res.json({ usingRedis });
  } catch (err) {
    console.error('Health check error:', err.message);
    return res.status(500).json({ usingRedis: false, error: err.message });
  }
});

module.exports = router;
