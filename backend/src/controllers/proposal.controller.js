export function createProposalController(service){
  const json=(res,value)=>res.set('Cache-Control','no-store').json(value);
  return {
    create:async(req,res)=>json(res.status(201),{proposal:await service.create(req.user,req.validated.params.projectId,req.validated.body)}),
    own:async(req,res)=>json(res,await service.listOwn(req.user,req.validated.query)),
    project:async(req,res)=>json(res,await service.listProject(req.user,req.validated.params.projectId,req.validated.query)),
    get:async(req,res)=>json(res,{proposal:await service.get(req.user,req.validated.params.proposalId)}),
    withdraw:async(req,res)=>json(res,{proposal:await service.withdraw(req.user,req.validated.params.proposalId)}),
    reject:async(req,res)=>json(res,{proposal:await service.reject(req.user,req.validated.params.proposalId,req.validated.body.reason)}),
    accept:async(req,res)=>json(res,{proposal:await service.accept(req.user,req.validated.params.proposalId)}),
  };
}
