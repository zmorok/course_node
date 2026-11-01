export function createOrderWorkController(service) {
  const command = (method) => async (request, response) =>
    response.set('Cache-Control', 'no-store').json(await method(request));

  return {
    submissions: command((request) =>
      service.submissions(request.user, request.validated.params.orderId, request.validated.query),
    ),
    deadlines: command((request) =>
      service.deadlines(request.user, request.validated.params.orderId, request.validated.query),
    ),
    events: command((request) =>
      service.events(request.user, request.validated.params.orderId, request.validated.query),
    ),
    cancel: command((request) =>
      service.cancel(request.user, request.validated.params.orderId, request.validated.body),
    ),
    submit: async (request, response) =>
      response
        .status(201)
        .set('Cache-Control', 'no-store')
        .json(
          await service.submit(
            request.user,
            request.validated.params.orderId,
            request.validated.body,
          ),
        ),

    revision: command((request) =>
      service.revision(
        request.user,
        request.validated.params.orderId,
        request.validated.params.submissionId,
        request.validated.body,
      ),
    ),
    accept: command((request) =>
      service.accept(
        request.user,
        request.validated.params.orderId,
        request.validated.params.submissionId,
        request.validated.body,
      ),
    ),
    requestDeadline: async (request, response) =>
      response
        .status(201)
        .set('Cache-Control', 'no-store')
        .json(
          await service.requestDeadline(
            request.user,
            request.validated.params.orderId,
            request.validated.body,
          ),
        ),

    approve: command((request) =>
      service.decideDeadline(
        request.user,
        request.validated.params.orderId,
        request.validated.params.requestId,
        request.validated.body,
        true,
      ),
    ),
    reject: command((request) =>
      service.decideDeadline(
        request.user,
        request.validated.params.orderId,
        request.validated.params.requestId,
        request.validated.body,
        false,
      ),
    ),
  };
}
