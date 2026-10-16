import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import { verifyToken } from '../helpers/quant0.js';

/**
 * Protect middleware: Exclusively verifies Quant0 Bearer tokens.
 * Legacy JWT cookies and local password session verification have been removed.
 */
const protect = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const claims = await verifyToken(token);
        const sub = claims.subject || claims.sub;
        req.user = await User.findOne({ quant0Sub: sub });
        if (req.user) {
          req.token = token;
          req.claims = claims;
          return next();
        }
      } catch (err) {
        console.error('[authMiddleware] Quant0 verification error:', err.message);
        res.status(401);
        throw new Error(`Not authorized: ${err.message}`);
      }
    }
  }

  res.status(401);
  throw new Error('Not authorized: Missing or invalid Quant0 Bearer token');
});

export { protect };
