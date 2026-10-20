export function createAdminController(service){const json=(res,data)=>res.set('Cache-Control','no-store').json(data);return {
  users:async(req,res)=>json(res,await service.users(req.user,req.validated.query)),
  user:async(req,res)=>json(res,await service.user(req.user,req.validated.params.userId)),
  sanctions:async(req,res)=>json(res,await service.sanctions(req.user,req.validated.params.userId,req.validated.query)),
  block:async(req,res)=>json(res,await service.block(req.user,req.validated.params.userId,req.validated.body)),
  unblock:async(req,res)=>json(res,await service.unblock(req.user,req.validated.params.userId,req.validated.body)),
};}
