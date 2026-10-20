export function createProfileController(service) {
  const respond = (response, data) => response.set('Cache-Control', 'no-store').json(data);
  return {
    changePassword: async (request,response) => respond(response,await service.changePassword(request.user,request.validated.body)),
    getOwn: async (request, response) => respond(response, { profile: await service.getOwn(request.user) }),
    getPublic: async (request, response) => respond(response, { profile: await service.getPublic(request.validated.params.userId) }),
    updateOwn: async (request, response) => respond(response, { profile: await service.updateOwn(request.user, request.validated.body) }),
    listSkills: async (_request, response) => respond(response, { skills: await service.listSkills() }),
    replaceSkills: async (request, response) => respond(response, { profile: await service.replaceSkills(request.user, request.validated.body.skillIds) }),
  };
}
