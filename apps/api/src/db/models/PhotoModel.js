import { createModel } from "./_factory.js";
import { generateObjectId } from "../../utils/objectId.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  ownerId: "owner_id",
  ownerName: "owner_name",
  imageUrl: "image_url",
  thumbUrl: "thumb_url",
  mediaType: "media_type",
  durationSeconds: "duration_seconds",
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

/**
 * These helpers read-modify-write a JSON column, so they take the tenant
 * explicitly rather than trusting the caller to have scoped the read first.
 * A collection mutation reached with another camp's id now finds nothing
 * instead of quietly editing that camp's row.
 */

  async addLike(tenantId, id, userId) {
    const doc = await base.findByIdScoped(tenantId, id);
    if (!doc) return null;
    const likes = doc.likes || [];
    if (!likes.includes(userId)) likes.push(userId);
    return base.updateScoped(tenantId, id, { likes });
  },

  async removeLike(tenantId, id, userId) {
    const doc = await base.findByIdScoped(tenantId, id);
    if (!doc) return null;
    const likes = (doc.likes || []).filter((l) => l !== userId);
    return base.updateScoped(tenantId, id, { likes });
  },

  async addComment(tenantId, id, comment) {
    const doc = await base.findByIdScoped(tenantId, id);
    if (!doc) return null;
    const comments = doc.comments || [];
    comments.push({
      _id: generateObjectId(),
      ...comment,
      createdAt: new Date().toISOString()
    });
    return base.updateScoped(tenantId, id, { comments });
  },

  async removeComment(tenantId, id, commentId) {
    const doc = await base.findByIdScoped(tenantId, id);
    if (!doc) return null;
    const comments = (doc.comments || []).filter(
      (c) => String(c._id) !== String(commentId)
    );
    return base.updateScoped(tenantId, id, { comments });
  }
};
