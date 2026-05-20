import express from 'express'
import { cancelActiveRequest } from '../controllers/requestController.js'

const router = express.Router()

router.post('/requests/:requestId/cancel', cancelActiveRequest)

export default router
