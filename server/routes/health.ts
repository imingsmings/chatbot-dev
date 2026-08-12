import express from 'express'
import { getHealth } from '../controllers/healthController.ts'

const router = express.Router()

router.get('/health', getHealth)

export default router
