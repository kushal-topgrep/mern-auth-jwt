import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import { verifyToken } from '../helpers/quant0.js';

const protect = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const cookieToken = req.cookies.jwt;

  // 1. Bearer Token (Quant0 access token)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const claims = await verifyToken(token);
        const sub = claims.subject || claims.sub;
        req.user = await User.findOne({ quant0Sub: sub }).select('-password');
        if (req.user) {
          return next();
        }
      } catch (err) {
        console.error('[authMiddleware] Quant0 token verification failed:', err.message);
        res.status(401);
        throw new Error(`Not authorized: ${err.message}`);
      }
    }
  }

  // 2. Cookie Token (Standard MERN session JWT)
  if (cookieToken) {
    try {
      const decoded = jwt.verify(cookieToken, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId).select('-password');
      if (req.user) {
        return next();
      }
    } catch (error) {
      console.error('[authMiddleware] Cookie verification failed:', error.message);
      res.status(401);
      throw new Error('Not authorized, token failed');
    }
  }

  res.status(401);
  throw new Error('Not authorized, no valid token');
});

export { protect };
