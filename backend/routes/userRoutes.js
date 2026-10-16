import express from 'express';
import {
  getUserProfile,
  updateUserProfile,
  quant0Session,
} from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Quant0 Session bootstrap
router.post('/quant0-session', quant0Session);

// Protected routes (Quant0 Bearer Token required)
router
  .route('/profile')
  .get(protect, getUserProfile)
  .put(protect, updateUserProfile);

export default router;
