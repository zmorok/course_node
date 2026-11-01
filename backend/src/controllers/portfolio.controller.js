export function createPortfolioController(service) {
  const json = (response, data) => response.set('Cache-Control', 'no-store').json(data);

  return {
    listOwn: async (request, response) =>
      json(response, { items: await service.listOwn(request.user) }),

    listPublic: async (request, response) =>
      json(response, { items: await service.listPublic(request.validated.params.userId) }),

    getOwn: async (request, response) =>
      json(response, { item: await service.getOwn(request.user, request.validated.params.itemId) }),

    create: async (request, response) =>
      json(response.status(201), {
        item: await service.save(request.user, null, request.validated.body),
      }),

    update: async (request, response) =>
      json(response, {
        item: await service.save(
          request.user,
          request.validated.params.itemId,
          request.validated.body,
        ),
      }),

    remove: async (request, response) => {
      await service.remove(request.user, request.validated.params.itemId);
      response.status(204).end();
    },
  };
}
