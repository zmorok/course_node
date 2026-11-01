export const createAuditController = (service) => ({
  export: async (request, response) =>
    response
      .set('Cache-Control', 'no-store')
      .attachment('workify-audit.json')
      .json(await service.export(request.user, request.validated.query)),

  import: async (request, response) =>
    response.json(await service.import(request.user, request.file.buffer)),

  imported: async (request, response) =>
    response
      .set('Cache-Control', 'no-store')
      .json(await service.imported(request.user, request.validated.query)),

  list: async (request, response) =>
    response
      .set('Cache-Control', 'no-store')
      .json(await service.list(request.user, request.validated.query)),
});
