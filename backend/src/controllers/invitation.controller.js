export function createInvitationController(service){
  const json=(res,data)=>res.set('Cache-Control','no-store').json(data);
  return {
    projects:async(req,res)=>json(res,{projects:await service.availableProjects(req.user,req.validated.params.userId)}),
    create:async(req,res)=>json(res.status(201),{invitation:await service.create(req.user,req.validated.params.projectId,req.validated.body)}),
    own:async(req,res)=>json(res,await service.listOwn(req.user,req.validated.query)),
    project:async(req,res)=>json(res,await service.listProject(req.user,req.validated.params.projectId,req.validated.query)),
    get:async(req,res)=>json(res,{invitation:await service.get(req.user,req.validated.params.invitationId)}),
    accept:async(req,res)=>json(res,{invitation:await service.accept(req.user,req.validated.params.invitationId)}),
    decline:async(req,res)=>json(res,{invitation:await service.decline(req.user,req.validated.params.invitationId,req.validated.body.reason)}),
  };
}
