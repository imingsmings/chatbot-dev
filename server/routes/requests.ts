import express from 'express'
import { cancelActiveRequest, getRequestResult } from '../controllers/requestController.ts'

const router = express.Router()

router.post('/requests/:requestId/cancel', cancelActiveRequest)
router.get('/requests/:requestId', getRequestResult)

export default router
