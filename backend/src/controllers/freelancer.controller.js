export function createFreelancerController(service){return {list:async(req,res)=>res.set('Cache-Control','no-store').json(await service.list(req.validated.query))};}
