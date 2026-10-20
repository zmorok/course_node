export function createNotificationController(service){return {
  list:async(req,res)=>res.set('Cache-Control','no-store').json(await service.list(req.user,req.validated.query)),
  unread:async(req,res)=>res.set('Cache-Control','no-store').json(await service.unread(req.user)),
  markRead:async(req,res)=>res.set('Cache-Control','no-store').json(await service.markRead(req.user,req.validated.params.notificationId)),
  markAllRead:async(req,res)=>res.set('Cache-Control','no-store').json(await service.markAllRead(req.user)),
};}
