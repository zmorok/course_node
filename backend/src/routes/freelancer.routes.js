import {Router} from 'express';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {freelancerQuery} from '../validators/freelancers.js';
import {createFreelancerController} from '../controllers/freelancer.controller.js';
export function createFreelancerRouter(service){const router=Router(),controller=createFreelancerController(service);router.get('/freelancers',validate(freelancerQuery,'query'),asyncHandler(controller.list));return router;}
