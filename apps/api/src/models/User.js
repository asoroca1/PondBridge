import { UserModel } from "../db/models/index.js";
import { toCompatDocument, toCompatDocuments } from "./_compatModel.js";

export const User = {
  async create(doc) {
    return toCompatDocument(UserModel, await UserModel.create(doc));
  },

  async insertMany(docs = []) {
    return toCompatDocuments(UserModel, await UserModel.insertMany(docs));
  },

  async find(filter = {}, options = {}) {
    return toCompatDocuments(UserModel, await UserModel.acrossTenants().find(filter, options));
  },

  async findOne(filter = {}) {
    return toCompatDocument(UserModel, await UserModel.acrossTenants().findOne(filter));
  },

  async findById(id) {
    return toCompatDocument(UserModel, await UserModel.findById(id));
  }
};
