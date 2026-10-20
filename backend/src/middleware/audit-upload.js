import multer from 'multer';
import {AppError} from '../utils/app-error.js';
const receive=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:0,parts:1}}).single('file');
export function auditUpload(req,res,next){receive(req,res,error=>{if(error)return next(new AppError(error.code==='LIMIT_FILE_SIZE'?413:422,'INVALID_AUDIT_UPLOAD','Отправьте один JSON-файл размером до 2 МБ'));if(!req.file)return next(new AppError(422,'INVALID_AUDIT_UPLOAD','Выберите JSON-файл'));next();});}
