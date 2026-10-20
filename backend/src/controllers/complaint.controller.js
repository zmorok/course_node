export function createComplaintController(service){return {
  create:async(req,res)=>res.status(201).set('Cache-Control','no-store').json({complaint:await service.create(req.user,req.validated.params.orderId,req.validated.body)}),
  order:async(req,res)=>res.set('Cache-Control','no-store').json(await service.order(req.user,req.validated.params.orderId)),
  list:async(req,res)=>res.set('Cache-Control','no-store').json(await service.list(req.user,req.validated.query)),
  own:async(req,res)=>res.set('Cache-Control','no-store').json({complaint:await service.own(req.user,req.validated.params.complaintId)}),
};}
