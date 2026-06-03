/**
 * Central error handler.
 * Attach a `status` property to errors before passing to next(err)
 * to control the HTTP status code.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  if (status === 500) {
    console.error('[ERROR]', err);
  }

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
