export function createAdminController(service) {
  const json = (response, data) => response.set('Cache-Control', 'no-store').json(data);

  return {
    createUser: async (request, response) =>
      response
        .status(201)
        .set('Cache-Control', 'no-store')
        .json(await service.createUser(request.user, request.validated.body)),

    updateUser: async (request, response) =>
      json(
        response,
        await service.updateUser(
          request.user,
          request.validated.params.userId,
          request.validated.body,
        ),
      ),

    deleteUser: async (request, response) =>
      json(
        response,
        await service.deleteUser(
          request.user,
          request.validated.params.userId,
          request.validated.body,
        ),
      ),

    users: async (request, response) =>
      json(response, await service.users(request.user, request.validated.query)),

    user: async (request, response) =>
      json(response, await service.user(request.user, request.validated.params.userId)),

    sanctions: async (request, response) =>
      json(
        response,
        await service.sanctions(
          request.user,
          request.validated.params.userId,
          request.validated.query,
        ),
      ),

    block: async (request, response) =>
      json(
        response,
        await service.block(request.user, request.validated.params.userId, request.validated.body),
      ),

    unblock: async (request, response) =>
      json(
        response,
        await service.unblock(
          request.user,
          request.validated.params.userId,
          request.validated.body,
        ),
      ),

    queue: async (request, response) =>
      json(response, await service.queue(request.user, request.validated.query)),

    detail: async (request, response) =>
      json(response, await service.detail(request.user, request.validated.params.complaintId)),

    context: async (request, response) =>
      json(
        response,
        await service.context(
          request.user,
          request.validated.params.complaintId,
          request.validated.params.section,
          request.validated.query,
        ),
      ),

    claim: async (request, response) =>
      json(response, await service.claim(request.user, request.validated.params.complaintId)),

    reject: async (request, response) =>
      json(
        response,
        await service.reject(
          request.user,
          request.validated.params.complaintId,
          request.validated.body,
        ),
      ),

    resolve: async (request, response) =>
      json(
        response,
        await service.resolve(
          request.user,
          request.validated.params.complaintId,
          request.validated.body,
        ),
      ),
  };
}
