import { pipeline } from 'node:stream/promises';
export function createFileController(service) {
  const json = (response, data) => response.set('Cache-Control', 'no-store').json(data);
  return {
    listOwn: async (request,response) => json(response, { files: await service.listOwn(request.user) }),
    upload: async (request,response) => json(response.status(201), { file: await service.upload(request.user,request.file) }),
    remove: async (request,response) => { await service.remove(request.user,request.validated.params.fileId); response.status(204).end(); },
    download: async (request,response) => {
      const { file, stream } = await service.open(request.validated.params.fileId, request.user);
      response.attachment(file.originalName).type(file.mimeType).set({ 'Cache-Control': 'no-store',
        'Content-Length': String(file.sizeBytes), 'Content-Security-Policy': "default-src 'none'; sandbox" });
      if (['image/jpeg','image/png','image/webp'].includes(file.mimeType)) response.set('Content-Disposition', response.get('Content-Disposition').replace(/^attachment/, 'inline'));
      await pipeline(stream,response);
    },
    getAvatar: async (request,response) => json(response, { avatarFileId: await service.getAvatar(request.user) }),
    setAvatar: async (request,response) => json(response, { avatarFileId: await service.setAvatar(request.user,request.validated.body.fileId) }),
    removeAvatar: async (request,response) => { await service.setAvatar(request.user,null); response.status(204).end(); },
  };
}
