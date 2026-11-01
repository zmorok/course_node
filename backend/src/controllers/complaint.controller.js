export function createComplaintController(service) {
  return {
    update: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(
          await service.update(
            request.user,
            request.validated.params.complaintId,
            request.validated.body,
          ),
        ),

    remove: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.remove(request.user, request.validated.params.complaintId)),

    create: async (request, response) =>
      response
        .status(201)
        .set('Cache-Control', 'no-store')
        .json({
          complaint: await service.create(
            request.user,
            request.validated.params.orderId,
            request.validated.body,
          ),
        }),

    order: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.order(request.user, request.validated.params.orderId)),

    list: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.list(request.user, request.validated.query)),

    own: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json({ complaint: await service.own(request.user, request.validated.params.complaintId) }),
  };
}
