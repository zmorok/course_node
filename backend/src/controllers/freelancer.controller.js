export function createFreelancerController(service) {
  return {
    list: async (request, response) =>
      response.set('Cache-Control', 'no-store').json(await service.list(request.validated.query)),
  };
}
