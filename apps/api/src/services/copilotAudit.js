export async function requireDurableCopilotAudit(
  writeOperation,
  {
    code = "COPILOT_AUDIT_UNAVAILABLE",
    message = "The assistant is unavailable because its audit trail could not be written."
  } = {}
) {
  if (typeof writeOperation !== "function") {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 503;
    throw error;
  }

  try {
    return await writeOperation();
  } catch (cause) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }
}
