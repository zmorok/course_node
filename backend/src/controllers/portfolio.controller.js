export function createPortfolioController(service) {
  const json = (response,data) => response.set('Cache-Control','no-store').json(data);
  return {
    listOwn: async (req,res) => json(res,{ items:await service.listOwn(req.user) }),
    listPublic: async (req,res) => json(res,{ items:await service.listPublic(req.validated.params.userId) }),
    getOwn: async (req,res) => json(res,{ item:await service.getOwn(req.user,req.validated.params.itemId) }),
    create: async (req,res) => json(res.status(201),{ item:await service.save(req.user,null,req.validated.body) }),
    update: async (req,res) => json(res,{ item:await service.save(req.user,req.validated.params.itemId,req.validated.body) }),
    remove: async (req,res) => { await service.remove(req.user,req.validated.params.itemId); res.status(204).end(); },
  };
}
