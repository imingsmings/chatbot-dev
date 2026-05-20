import express from 'express'
import { clearHistory, listHistory } from '../controllers/legacyController.js'

const router = express.Router()

router.get('/history', listHistory)
router.post('/clear', clearHistory)

export default router
