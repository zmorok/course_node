export function createWarningController(service) {
  return {
    list: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.list(request.user, request.validated.query)),

    issue: async (request, response) =>
      response
        .status(201)
        .set('Cache-Control', 'no-store')
        .json({
          warning: await service.issue(
            request.user,
            request.validated.params.userId,
            request.validated.body,
          ),
        }),
  };
}
