import express from 'express'
import { cancelActiveRequest } from '../controllers/requestController.ts'

const router = express.Router()

router.post('/requests/:requestId/cancel', cancelActiveRequest)

export default router
