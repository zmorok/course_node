export function createWarningController(service){return {
  list:async(req,res)=>res.set('Cache-Control','no-store').json(await service.list(req.user,req.validated.query)),
  issue:async(req,res)=>res.status(201).set('Cache-Control','no-store').json({warning:await service.issue(req.user,req.validated.params.userId,req.validated.body)}),
};}
