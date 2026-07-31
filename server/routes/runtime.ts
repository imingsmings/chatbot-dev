import express from 'express'
import { getRuntimeConfiguration } from '../controllers/runtimeController.ts'

const router = express.Router()

router.get('/runtime-config', getRuntimeConfiguration)

export default router
