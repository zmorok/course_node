export function createOrderController(service){return {
  own:async(req,res)=>res.set('Cache-Control','no-store').json(await service.list(req.user,req.validated.query)),
  get:async(req,res)=>res.set('Cache-Control','no-store').json({order:await service.get(req.user,req.validated.params.orderId)}),
};}
