import { TenantModel } from "../db/models/index.js";
import { toCompatDocument, toCompatDocuments } from "./_compatModel.js";

export const Tenant = {
  async create(doc) {
    return toCompatDocument(TenantModel, await TenantModel.create(doc));
  },

  async insertMany(docs = []) {
    return toCompatDocuments(TenantModel, await TenantModel.insertMany(docs));
  },

  async find(filter = {}, options = {}) {
    return toCompatDocuments(TenantModel, await TenantModel.find(filter, options));
  },

  async findOne(filter = {}) {
    return toCompatDocument(TenantModel, await TenantModel.findOne(filter));
  },

  async findById(id) {
    return toCompatDocument(TenantModel, await TenantModel.findById(id));
  }
};
