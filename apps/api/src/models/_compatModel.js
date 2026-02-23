function stripCompatKeys(doc = {}) {
  const next = { ...doc };
  delete next.save;
  delete next._id;
  return next;
}

export function toCompatDocument(model, doc) {
  if (!doc) return null;

  Object.defineProperty(doc, "save", {
    enumerable: false,
    configurable: true,
    writable: false,
    value: async function save() {
      const patch = stripCompatKeys(this);
      const updated = await model.update(this._id, patch);
      Object.assign(this, updated);
      return this;
    }
  });

  return doc;
}

export function toCompatDocuments(model, docs = []) {
  return docs.map((doc) => toCompatDocument(model, doc));
}
