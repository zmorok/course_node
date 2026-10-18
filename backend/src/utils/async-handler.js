export function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve()
    .then(() => handler(request, response, next))
    .catch(error => next(error instanceof Error ? error : new Error('Async handler rejected without an Error', { cause: error })));
}
