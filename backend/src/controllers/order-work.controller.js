export function createOrderWorkController(service){const command=method=>async(req,res)=>res.set('Cache-Control','no-store').json(await method(req));return {
  submissions:command(req=>service.submissions(req.user,req.validated.params.orderId,req.validated.query)),
  deadlines:command(req=>service.deadlines(req.user,req.validated.params.orderId,req.validated.query)),
  submit:async(req,res)=>res.status(201).set('Cache-Control','no-store').json(await service.submit(req.user,req.validated.params.orderId,req.validated.body)),
  revision:command(req=>service.revision(req.user,req.validated.params.orderId,req.validated.params.submissionId,req.validated.body)),
  accept:command(req=>service.accept(req.user,req.validated.params.orderId,req.validated.params.submissionId,req.validated.body)),
  requestDeadline:async(req,res)=>res.status(201).set('Cache-Control','no-store').json(await service.requestDeadline(req.user,req.validated.params.orderId,req.validated.body)),
  approve:command(req=>service.decideDeadline(req.user,req.validated.params.orderId,req.validated.params.requestId,req.validated.body,true)),
  reject:command(req=>service.decideDeadline(req.user,req.validated.params.orderId,req.validated.params.requestId,req.validated.body,false)),
};}
