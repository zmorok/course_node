export function createProjectController(service) {
  const json = (response, value) => response.set('Cache-Control', 'no-store').json(value);

  return {
    categories: async (_request, response) =>
      json(response, { categories: await service.categories() }),

    catalog: async (request, response) =>
      json(response, await service.list(request.validated.query, request.user)),

    own: async (request, response) =>
      json(response, await service.list(request.validated.query, request.user, true)),

    get: async (request, response) =>
      json(response, {
        project: await service.get(request.validated.params.projectId, request.user),
      }),

    create: async (request, response) =>
      json(response.status(201), {
        project: await service.create(request.user, request.validated.body),
      }),

    patch: async (request, response) =>
      json(response, {
        project: await service.patch(
          request.user,
          request.validated.params.projectId,
          request.validated.body,
        ),
      }),

    publish: async (request, response) =>
      json(response, {
        project: await service.publish(request.user, request.validated.params.projectId),
      }),

    cancel: async (request, response) =>
      json(response, {
        project: await service.cancel(
          request.user,
          request.validated.params.projectId,
          request.validated.body.reason,
        ),
      }),

    remove: async (request, response) => {
      await service.remove(request.user, request.validated.params.projectId);
      response.status(204).end();
    },

    attachFile: async (request, response) =>
      json(response, {
        project: await service.attachFile(
          request.user,
          request.validated.params.projectId,
          request.validated.body.fileId,
        ),
      }),

    detachFile: async (request, response) =>
      json(response, {
        project: await service.detachFile(
          request.user,
          request.validated.params.projectId,
          request.validated.params.fileId,
        ),
      }),
  };
}
