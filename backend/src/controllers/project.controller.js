export function createProjectController(service) {
  const json=(res,value)=>res.set('Cache-Control','no-store').json(value);
  return {
    categories:async(_req,res)=>json(res,{categories:await service.categories()}),
    catalog:async(req,res)=>json(res,await service.list(req.validated.query,req.user)),
    own:async(req,res)=>json(res,await service.list(req.validated.query,req.user,true)),
    get:async(req,res)=>json(res,{project:await service.get(req.validated.params.projectId,req.user)}),
    create:async(req,res)=>json(res.status(201),{project:await service.create(req.user,req.validated.body)}),
    patch:async(req,res)=>json(res,{project:await service.patch(req.user,req.validated.params.projectId,req.validated.body)}),
    publish:async(req,res)=>json(res,{project:await service.publish(req.user,req.validated.params.projectId)}),
    cancel:async(req,res)=>json(res,{project:await service.cancel(req.user,req.validated.params.projectId,req.validated.body.reason)}),
    remove:async(req,res)=>{await service.remove(req.user,req.validated.params.projectId);res.status(204).end();},
    attachFile:async(req,res)=>json(res,{project:await service.attachFile(req.user,req.validated.params.projectId,req.validated.body.fileId)}),
    detachFile:async(req,res)=>json(res,{project:await service.detachFile(req.user,req.validated.params.projectId,req.validated.params.fileId)}),
  };
}
