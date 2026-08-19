import { ProfileModel } from "../db/models/index.js";
import { toCompatDocument, toCompatDocuments } from "./_compatModel.js";

export const Profile = {
  async create(doc) {
    return toCompatDocument(ProfileModel, await ProfileModel.create(doc));
  },

  async insertMany(docs = []) {
    return toCompatDocuments(ProfileModel, await ProfileModel.insertMany(docs));
  },

  async find(filter = {}, options = {}) {
    return toCompatDocuments(ProfileModel, await ProfileModel.acrossTenants().find(filter, options));
  },

  async findOne(filter = {}) {
    return toCompatDocument(ProfileModel, await ProfileModel.acrossTenants().findOne(filter));
  },

  async findById(id) {
    return toCompatDocument(ProfileModel, await ProfileModel.findById(id));
  }
};
