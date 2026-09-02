import { assertPlatformAuditMigrationTarget } from "../scripts/applyPlatformAuditSchema.js";
import { assertMemberSafetyMigrationTarget } from "../scripts/applyMemberSafetySchema.js";
import { assertDatabaseSecurityHardeningTarget } from "../scripts/applyDatabaseSecurityHardening.js";
import { assertDatabasePerformanceHardeningTarget } from "../scripts/applyDatabasePerformanceHardening.js";
import { assertOutreachWorkspaceMigrationTarget } from "../scripts/applyOutreachWorkspaceSchema.js";
import { buildMigrationPlan } from "../scripts/dbPreflightCheck.js";

describe("platform audit migration safety", () => {
  test("rejects an unlabeled or production target", () => {
    expect(() => assertPlatformAuditMigrationTarget({
      targetEnvironment: "production",
      acknowledgement: "apply-platform-audit-staging",
      connectionString: "postgresql://example.invalid/postgres"
    })).toThrow(/intentionally rejected/i);
  });

  test("requires a deliberate acknowledgement for remote staging", () => {
    expect(() => assertPlatformAuditMigrationTarget({
      targetEnvironment: "staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toThrow(/PONDBRIDGE_SCHEMA_APPLY_ACK/);
  });

  test("allows a reviewed remote staging target and local development", () => {
    expect(assertPlatformAuditMigrationTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-platform-audit-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toEqual({ target: "staging", isLocal: false });

    expect(assertPlatformAuditMigrationTarget({
      targetEnvironment: "local",
      connectionString: "postgresql://localhost/postgres"
    })).toEqual({ target: "local", isLocal: true });
  });

  test("member safety migration uses its own reviewed staging acknowledgement", () => {
    expect(() => assertMemberSafetyMigrationTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-platform-audit-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toThrow(/apply-member-safety-staging/);

    expect(assertMemberSafetyMigrationTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-member-safety-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toEqual({ target: "staging", isLocal: false });
  });

  test("database security hardening uses its own reviewed staging acknowledgement", () => {
    expect(() => assertDatabaseSecurityHardeningTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-member-safety-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toThrow(/apply-database-security-hardening-staging/);

    expect(assertDatabaseSecurityHardeningTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-database-security-hardening-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toEqual({ target: "staging", isLocal: false });
  });

  test("database performance hardening uses its own reviewed staging acknowledgement", () => {
    expect(() => assertDatabasePerformanceHardeningTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-database-security-hardening-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toThrow(/apply-database-performance-hardening-staging/);

    expect(assertDatabasePerformanceHardeningTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-database-performance-hardening-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toEqual({ target: "staging", isLocal: false });
  });

  test("outreach workspace migration requires its own reviewed staging acknowledgement", () => {
    expect(() => assertOutreachWorkspaceMigrationTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-member-safety-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toThrow(/apply-outreach-workspace-staging/);

    expect(assertOutreachWorkspaceMigrationTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-outreach-workspace-staging",
      connectionString: "postgresql://db.example.invalid/postgres"
    })).toEqual({ target: "staging", isLocal: false });
  });

  test("database preflight maps every gated table to an ordered migration", () => {
    expect(buildMigrationPlan(
      [
        "platform_admin_audit_logs",
        "feature_rollouts",
        "ai_generations",
        "identities",
        "member_blocks",
        "content_reports",
        "outreach_accounts"
      ],
      ["idx_feature_rollouts_state", "idx_content_reports_active_dedup"]
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "platform_audit" }),
      expect.objectContaining({ id: "rollout_control" }),
      expect.objectContaining({ id: "communications_system" }),
      expect.objectContaining({ id: "multi_camp_identity" }),
      expect.objectContaining({
        id: "member_safety",
        acknowledgement: "apply-member-safety-staging"
      }),
      expect.objectContaining({
        id: "outreach_workspace",
        acknowledgement: "apply-outreach-workspace-staging"
      })
    ]));
  });

  test("database preflight routes function security findings to the guarded hardening step", () => {
    expect(buildMigrationPlan([], [], ["public.search_profiles(...):mutable_search_path"]))
      .toEqual([
        expect.objectContaining({
          id: "database_security_hardening",
          acknowledgement: "apply-database-security-hardening-staging"
        })
      ]);
  });

  test("database preflight maps missing foreign-key indexes to performance hardening", () => {
    expect(buildMigrationPlan([], ["idx_messages_conversation_fk"]))
      .toEqual([
        expect.objectContaining({
          id: "database_performance_hardening",
          acknowledgement: "apply-database-performance-hardening-staging"
        })
      ]);
  });
});
