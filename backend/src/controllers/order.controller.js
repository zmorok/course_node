export function createOrderController(service) {
  return {
    own: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.list(request.user, request.validated.query)),

    get: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json({ order: await service.get(request.user, request.validated.params.orderId) }),
  };
}
