export function createProposalController(service) {
  const json = (response, value) => response.set('Cache-Control', 'no-store').json(value);

  return {
    create: async (request, response) =>
      json(response.status(201), {
        proposal: await service.create(
          request.user,
          request.validated.params.projectId,
          request.validated.body,
        ),
      }),

    own: async (request, response) =>
      json(response, await service.listOwn(request.user, request.validated.query)),

    project: async (request, response) =>
      json(
        response,
        await service.listProject(
          request.user,
          request.validated.params.projectId,
          request.validated.query,
        ),
      ),

    get: async (request, response) =>
      json(response, {
        proposal: await service.get(request.user, request.validated.params.proposalId),
      }),

    withdraw: async (request, response) =>
      json(response, {
        proposal: await service.withdraw(request.user, request.validated.params.proposalId),
      }),

    reject: async (request, response) =>
      json(response, {
        proposal: await service.reject(
          request.user,
          request.validated.params.proposalId,
          request.validated.body.reason,
        ),
      }),

    accept: async (request, response) =>
      json(response, {
        proposal: await service.accept(request.user, request.validated.params.proposalId),
      }),
  };
}
