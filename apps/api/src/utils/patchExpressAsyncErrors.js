import Layer from "express/lib/router/layer.js";

let patched = false;

export function patchExpressAsyncErrors() {
  if (patched) return;
  patched = true;

  const originalHandleRequest = Layer.prototype.handle_request;

  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const handler = this.handle;

    // Let Express handle classic error middleware unchanged.
    if (handler.length > 3) {
      return originalHandleRequest.call(this, req, res, next);
    }

    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === "function") {
        result.catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}
