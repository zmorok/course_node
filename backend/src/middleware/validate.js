export function validate(parse, source = 'body') {
  if (!['body', 'params', 'query'].includes(source)) throw new TypeError('Unsupported validation source');
  return (request, _response, next) => {
    try {
      const data = parse(request[source]);
      request.validated = { ...request.validated, [source]: data };
      next();
    } catch (error) {
      next(error);
    }
  };
}
