import Errors from 'http-errors';

/**
 * Denali uses the **http-errors** package for handling HTTP errors. Check [it's
 * documentation](https://github.com/jshttp/http-errors) for how to use it.
 *
 * @class Error
 * @module denali
 * @submodule runtime
 */
export default Errors;

export function expect(value, field) {
  if (!value) {
    throw new Errors.UnprocessableEntity(`Missing or invalid ${ field }`);
  }
}
