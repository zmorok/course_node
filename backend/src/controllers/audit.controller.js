export const createAuditController=service=>({list:async(req,res)=>res.set('Cache-Control','no-store').json(await service.list(req.user,req.validated.query))});
