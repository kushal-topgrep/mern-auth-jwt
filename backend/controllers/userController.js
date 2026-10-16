import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import { verifyToken, fetchMe } from '../helpers/quant0.js';

// @desc    Authenticate / Provision user via Quant0 access token
// @route   POST /api/users/quant0-session
// @access  Public
const quant0Session = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : req.body.token;

  if (!token) {
    res.status(401);
    throw new Error('No Quant0 access token provided');
  }

  let claims;
  try {
    claims = await verifyToken(token);
  } catch (err) {
    res.status(401);
    throw new Error(err.message || 'Token verification rejected by Quant0');
  }

  const profile = await fetchMe(token);
  const sub = claims.subject || claims.sub;

  // 1. Decode id_token if provided in request body
  let idClaims = {};
  if (req.body?.id_token) {
    try {
      const parts = req.body.id_token.split('.');
      if (parts[1]) {
        idClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      }
    } catch (e) {
      console.warn('[quant0] Could not parse id_token payload:', e.message);
    }
  }

  // 2. Resolve email with reliable fallbacks
  const email =
    req.body?.email ||
    idClaims?.email ||
    profile?.email ||
    claims.email ||
    (claims.subject && claims.subject.includes('@') ? claims.subject : null) ||
    (sub ? `${sub}@quant0.local` : `user_${Date.now()}@quant0.local`);

  // 3. Resolve name
  const name =
    req.body?.name ||
    idClaims?.name ||
    profile?.name ||
    profile?.display_name ||
    claims.name ||
    (email && email.includes('@') ? email.split('@')[0] : 'User');

  // 4. Check if user already exists by quant0Sub
  let user = await User.findOne({ quant0Sub: sub });

  // 5. If not found by sub, check by email and link quant0Sub
  if (!user && email) {
    user = await User.findOne({ email });
    if (user) {
      user.quant0Sub = sub;
      await user.save();
    }
  }

  // 6. If still not found, provision new Quant0 user
  if (!user) {
    user = await User.create({
      name,
      email,
      quant0Sub: sub,
    });
  }

  res.status(200).json({
    _id: user._id,
    name: user.name,
    email: user.email,
  });
});

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private (Quant0 Bearer Token)
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private (Quant0 Bearer Token)
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

export {
  quant0Session,
  getUserProfile,
  updateUserProfile,
};
