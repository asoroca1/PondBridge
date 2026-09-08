export function validateGivingStep(form, step) {
  if (step === 0) {
    if (!form.title.trim()) return "Enter a cause name.";
    if (!form.shortDescription.trim()) return "Add a short description of your cause.";
    if (!form.category) return "Choose a category for your cause.";
  }
  if (step === 1) {
    if (form.description.trim().length < 30) return "Tell us what this cause will accomplish in at least 30 characters.";
    if (form.coverImageUrl.trim()) {
      try {
        const url = new URL(form.coverImageUrl);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      } catch { return "Enter a valid web address for the cover image, or leave it blank."; }
    }
  }
  if (step === 2) {
    const goal = Number(form.goalDollars);
    if (!Number.isFinite(goal) || goal < 1 || !Number.isSafeInteger(Math.round(goal * 100))) return "Enter a valid fundraising goal of at least $1.";
    if (form.startDate && form.endDate && form.endDate < form.startDate) return "Choose an end date on or after the start date.";
  }
  return "";
}
