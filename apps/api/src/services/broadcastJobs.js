import { env } from "../config/env.js";
import { AlumniContactModel, EmailBroadcastModel } from "../db/models/index.js";
import { sendBulkTransactionalEmail, buildTenantEmailBranding } from "./email.js";
import { buildEmailPreferenceUrls, resolveEmailRecipientEligibility, COMMUNITY_UPDATES_TOPIC } from "./emailPreferences.js";
import { registerJobHandler, saveJob, jobError, jobFingerprint } from "./durableJobs.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export async function processBroadcastJob(job, { tenant }) {
  const payload = job.payload;
  const end = Math.min(job.cursor + 40, job.total);
  const audience = payload.recipients.slice(job.cursor, end);
  let eligible;
  try {
    const [eligibility, held] = await Promise.all([
      resolveEmailRecipientEligibility({ tenantId: job.tenant_id, recipients: audience, topicKey: COMMUNITY_UPDATES_TOPIC }),
      AlumniContactModel.find(job.tenant_id, { email: { $in: audience }, contactStatus: "do_not_contact" })
    ]);
    const heldEmails = new Set(held.map((item) => String(item.email).toLowerCase()));
    eligible = eligibility.deliverableRecipients.filter((email) => !heldEmails.has(email));
  } catch { throw jobError("RECIPIENT_ELIGIBILITY_UNAVAILABLE", true); }
  if (!["mock", "resend"].includes(String(env.EMAIL_MODE || "mock"))) throw jobError("BROADCAST_DURABLE_TRANSPORT_UNSUPPORTED");
  const transport = jobFingerprint({ version: 1, mode: env.EMAIL_MODE || "mock", batch: env.RESEND_BATCH_ENABLED,
    bytes: env.RESEND_BATCH_MAX_BYTES, batchSize: 40, providerEndpoint: env.RESEND_API_BASE_URL, providerAccount: env.RESEND_API_KEY || "" });
  let prepared = job.state?.prepared;
  if (prepared && prepared.transport !== transport) throw jobError("BROADCAST_TRANSPORT_CHANGED_REVIEW_REQUIRED");
  if (prepared && JSON.stringify(prepared.recipients) !== JSON.stringify(eligible)) {
    // An uncertain provider attempt cannot be replayed with a different body.
    throw jobError("RECIPIENT_ELIGIBILITY_CHANGED_REVIEW_REQUIRED");
  }
  if (!prepared) {
    const messages = {};
    for (const email of eligible) {
      const names = payload.names[email] || {};
      const urls = buildEmailPreferenceUrls({ tenantId: job.tenant_id, email, topicKey: COMMUNITY_UPDATES_TOPIC });
      const values = { firstName: names.firstName || "there", lastName: names.lastName || "", unsubscribeUrl: urls.manageUrl };
      const replace = (body, html) => body.replace(/\{\{(firstName|lastName|unsubscribeUrl)\}\}/g, (_, key) => html ? escapeHtml(values[key]) : values[key]);
      messages[email] = { html: replace(payload.composed.html, true), text: replace(payload.composed.text, false), headers: {
        "List-Unsubscribe": `<${urls.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "List-ID": `${tenant.slug}.community <community.${tenant.slug}.pondbridgealumni.com>`
      } };
    }
    prepared = { transport, tenantSlug: tenant.slug, recipients: eligible, messages, from: buildTenantEmailBranding(tenant, { stream: "bulk" }).from };
    if (Buffer.byteLength(JSON.stringify(prepared), "utf8") > 5_000_000) throw jobError("BROADCAST_CONTENT_TOO_LARGE");
    await saveJob(job, { state: { ...job.state, prepared } });
  }
  let broadcast = await EmailBroadcastModel.findOne(job.tenant_id, { _id: job.id });
  if (!broadcast) broadcast = await EmailBroadcastModel.create({ ...payload.broadcast, id: job.id, tenantId: job.tenant_id });
  if (job.leaseLost) throw jobError("JOB_LEASE_LOST");
  let delivery = { sentCount: 0, suppressedCount: 0, failedCount: 0 };
  if (eligible.length) {
    try {
      delivery = await sendBulkTransactionalEmail({ from: prepared.from, recipients: prepared.recipients,
        subject: payload.broadcast.subject, text: payload.composed.text, html: payload.composed.html,
        ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
        tags: [{ name: "category", value: "director_broadcast" }, { name: "tenant", value: prepared.tenantSlug }, { name: "pondbridge_broadcast", value: job.id }],
        requireUnchangedRecipients: true, idempotencyKey: `durable-broadcast/${job.id}/${job.cursor}`, batchSize: 40, maxRecipients: 40,
        personalizer: (email) => prepared.messages[email] });
    } catch (error) {
      throw jobError("BROADCAST_PROVIDER_UNAVAILABLE", !error?.statusCode || error.statusCode === 429 || error.statusCode >= 500);
    }
  }
  if (delivery.failedCount && !delivery.sentCount) throw jobError("BROADCAST_BATCH_NOT_ACCEPTED", true);
  const state = { accepted: Number(job.state?.accepted || 0) + delivery.sentCount,
    skipped: Number(job.state?.skipped || 0) + audience.length - eligible.length + Number(delivery.suppressedCount || 0) };
  await EmailBroadcastModel.updateScoped(job.tenant_id, job.id, {
    status: delivery.failedCount ? "failed" : end === job.total ? "sent" : "draft",
    sentAt: end === job.total && !delivery.failedCount ? new Date() : null,
    stats: { ...broadcast.stats, queue: { id: job.id, processed: end, total: job.total }, delivery: { acceptedCount: state.accepted, sentCount: state.accepted, suppressedCount: state.skipped } }
  });
  if (delivery.failedCount) {
    await saveJob(job, { cursor: end, state, error: "PERMANENT:BROADCAST_PARTIAL_ACCEPTANCE_REVIEW_REQUIRED" });
    return { terminal: true };
  }
  return { cursor: end, state };
}
registerJobHandler("broadcast", processBroadcastJob);
