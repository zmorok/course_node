export function createNotificationController(service) {
  return {
    list: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.list(request.user, request.validated.query)),

    unread: async (request, response) =>
      response.set('Cache-Control', 'no-store').json(await service.unread(request.user)),

    markRead: async (request, response) =>
      response
        .set('Cache-Control', 'no-store')
        .json(await service.markRead(request.user, request.validated.params.notificationId)),

    markAllRead: async (request, response) =>
      response.set('Cache-Control', 'no-store').json(await service.markAllRead(request.user)),
  };
}
