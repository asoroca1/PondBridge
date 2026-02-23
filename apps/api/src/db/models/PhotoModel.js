import { createModel } from "./_factory.js";
import { generateObjectId } from "../../utils/objectId.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  ownerId: "owner_id",
  ownerName: "owner_name",
  imageUrl: "image_url",
  thumbUrl: "thumb_url",
  caption: "caption",
  captionMentions: "caption_mentions",
  likes: "likes",
  comments: "comments",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("photos", COLUMNS);

export const PhotoModel = {
  ...base,

  async addLike(id, userId) {
    const doc = await base.findById(id);
    if (!doc) return null;
    const likes = doc.likes || [];
    if (!likes.includes(userId)) likes.push(userId);
    return base.update(id, { likes });
  },

  async removeLike(id, userId) {
    const doc = await base.findById(id);
    if (!doc) return null;
    const likes = (doc.likes || []).filter((l) => l !== userId);
    return base.update(id, { likes });
  },

  async addComment(id, comment) {
    const doc = await base.findById(id);
    if (!doc) return null;
    const comments = doc.comments || [];
    comments.push({
      _id: generateObjectId(),
      ...comment,
      createdAt: new Date().toISOString()
    });
    return base.update(id, { comments });
  },

  async removeComment(id, commentId) {
    const doc = await base.findById(id);
    if (!doc) return null;
    const comments = (doc.comments || []).filter(
      (c) => String(c._id) !== String(commentId)
    );
    return base.update(id, { comments });
  }
};
