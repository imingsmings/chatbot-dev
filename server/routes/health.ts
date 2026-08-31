import express from 'express'
import {
  getHealth,
  getLiveness,
  getReadiness,
} from '../controllers/healthController.ts'

const router = express.Router()

router.get('/health', getHealth)
router.get('/health/live', getLiveness)
router.get('/health/ready', getReadiness)

export default router
