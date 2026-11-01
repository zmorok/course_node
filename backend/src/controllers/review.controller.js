export function createReviewController(service) {
  return {
    create: async (request, response) =>
      response
        .status(201)
        .set('Cache-Control', 'no-store')
        .json({
          review: await service.create(
            request.user,
            request.validated.params.orderId,
            request.validated.body,
          ),
        }),

    order: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.order(request.user, request.validated.params.orderId)),

    own: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.own(request.user, request.validated.query)),

    public: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.public(request.validated.params.userId, request.validated.query)),

    update: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json({
          review: await service.update(
            request.user,
            request.validated.params.reviewId,
            request.validated.body,
          ),
        }),

    hide: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json({ review: await service.hide(request.user, request.validated.params.reviewId) }),

    restore: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json({ review: await service.restore(request.user, request.validated.params.reviewId) }),
  };
}
