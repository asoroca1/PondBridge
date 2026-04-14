import "dotenv/config";
import { TenantModel } from "../src/db/models/TenantModel.js";

async function main() {
  const tenants = await TenantModel.find({});
  let updatedCount = 0;

  for (const tenant of tenants) {
    const tenantId = String(tenant?._id || tenant?.id || "").trim();
    if (!tenantId) continue;

    const currentModules = tenant?.modules && typeof tenant.modules === "object"
      ? tenant.modules
      : {};

    if (currentModules.events === true) {
      continue;
    }

    await TenantModel.update(tenantId, {
      modules: {
        ...currentModules,
        events: true
      }
    });
    updatedCount += 1;
  }

  console.log(`Events enabled for ${updatedCount} tenant${updatedCount === 1 ? "" : "s"}.`);
}

main()
  .catch((error) => {
    console.error("Failed to enable events for all tenants.");
    console.error(error);
    process.exitCode = 1;
  });
