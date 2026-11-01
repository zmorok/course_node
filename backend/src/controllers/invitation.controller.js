export function createInvitationController(service) {
  const json = (response, data) => response.set('Cache-Control', 'no-store').json(data);

  return {
    projects: async (request, response) =>
      json(response, {
        projects: await service.availableProjects(request.user, request.validated.params.userId),
      }),

    create: async (request, response) =>
      json(response.status(201), {
        invitation: await service.create(
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
        invitation: await service.get(request.user, request.validated.params.invitationId),
      }),

    accept: async (request, response) =>
      json(response, {
        invitation: await service.accept(request.user, request.validated.params.invitationId),
      }),

    decline: async (request, response) =>
      json(response, {
        invitation: await service.decline(
          request.user,
          request.validated.params.invitationId,
          request.validated.body.reason,
        ),
      }),
  };
}
