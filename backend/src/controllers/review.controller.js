export function createReviewController(service){return {
  create:async(req,res)=>res.status(201).set('Cache-Control','no-store').json({review:await service.create(req.user,req.validated.params.orderId,req.validated.body)}),
  order:async(req,res)=>res.set('Cache-Control','no-store').json(await service.order(req.user,req.validated.params.orderId)),
  own:async(req,res)=>res.set('Cache-Control','no-store').json(await service.own(req.user,req.validated.query)),
  public:async(req,res)=>res.set('Cache-Control','no-store').json(await service.public(req.validated.params.userId,req.validated.query)),
  update:async(req,res)=>res.set('Cache-Control','no-store').json({review:await service.update(req.user,req.validated.params.reviewId,req.validated.body)}),
  hide:async(req,res)=>res.set('Cache-Control','no-store').json({review:await service.hide(req.user,req.validated.params.reviewId)}),
  restore:async(req,res)=>res.set('Cache-Control','no-store').json({review:await service.restore(req.user,req.validated.params.reviewId)}),
};}
