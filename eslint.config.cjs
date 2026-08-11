const globals = require("globals");
const reactPlugin = require("eslint-plugin-react");

module.exports = [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/_import/**",
      "**/*.min.js",
      // Bundled web output copied into the native shells — not source.
      "apps/ios/**/public/assets/**"
    ]
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    plugins: {
      react: reactPlugin
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      "react/jsx-uses-vars": "error",
      // A reference to something that no longer exists builds and bundles
      // cleanly, then throws on the page. These are the only gates that catch
      // it before a director does. `no-undef` misses JSX entirely — the parser
      // emits JSXIdentifier nodes that scope analysis never treats as
      // references — so an unimported <Component /> needs its own rule.
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    // API tests run under Jest, which supplies describe/test/expect ambiently.
    files: ["apps/api/tests/**/*.js", "**/*.test.js"],
    languageOptions: { globals: { ...globals.jest } }
  },
  {
    files: [
      "apps/api/src/routes/profiles.js",
      "apps/api/src/routes/search.js",
      "apps/api/src/routes/admin.js",
      "apps/api/src/routes/familyTrees.js",
      "apps/api/src/routes/tenantAuth.js"
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Profile",
          property: "find",
          message: "Use tenantQuery(Profile, tenantId, filter) for tenant-scoped reads."
        },
        {
          object: "Profile",
          property: "findOne",
          message: "Use tenantFindOne(Profile, tenantId, filter) for tenant-scoped reads."
        },
        {
          object: "Profile",
          property: "findById",
          message: "Use tenantFindOne(Profile, tenantId, { _id }) for tenant-scoped reads."
        },
        {
          object: "Profile",
          property: "findOneAndUpdate",
          message: "Use tenantFindOneAndUpdate(Profile, tenantId, filter, update, options)."
        },
        {
          object: "Profile",
          property: "findOneAndDelete",
          message: "Use tenantFindOneAndDelete(Profile, tenantId, filter)."
        },
        {
          object: "Profile",
          property: "countDocuments",
          message: "Use tenantCount(Profile, tenantId, filter)."
        },
        {
          object: "Profile",
          property: "create",
          message: "Use tenantCreate(Profile, tenantId, payload)."
        },
        {
          object: "User",
          property: "find",
          message: "Use tenantQuery(User, tenantId, filter) for tenant-scoped reads."
        },
        {
          object: "User",
          property: "findOne",
          message: "Use tenantFindOne(User, tenantId, filter) for tenant-scoped reads."
        },
        {
          object: "User",
          property: "findById",
          message: "Use tenantFindOne(User, tenantId, { _id }) for tenant-scoped reads."
        },
        {
          object: "User",
          property: "findOneAndUpdate",
          message: "Use tenantFindOneAndUpdate(User, tenantId, filter, update, options)."
        },
        {
          object: "User",
          property: "findOneAndDelete",
          message: "Use tenantFindOneAndDelete(User, tenantId, filter)."
        },
        {
          object: "User",
          property: "countDocuments",
          message: "Use tenantCount(User, tenantId, filter)."
        },
        {
          object: "User",
          property: "create",
          message: "Use tenantCreate(User, tenantId, payload)."
        },
        {
          object: "FamilyTree",
          property: "find",
          message: "Use tenantQuery(FamilyTree, tenantId, filter) for tenant-scoped reads."
        },
        {
          object: "FamilyTree",
          property: "findOne",
          message: "Use tenantFindOne(FamilyTree, tenantId, filter) for tenant-scoped reads."
        },
        {
          object: "FamilyTree",
          property: "findOneAndUpdate",
          message: "Use tenantFindOneAndUpdate(FamilyTree, tenantId, filter, update, options)."
        },
        {
          object: "FamilyTree",
          property: "findOneAndDelete",
          message: "Use tenantFindOneAndDelete(FamilyTree, tenantId, filter)."
        },
        {
          object: "FamilyTree",
          property: "countDocuments",
          message: "Use tenantCount(FamilyTree, tenantId, filter)."
        },
        {
          object: "FamilyTree",
          property: "create",
          message: "Use tenantCreate(FamilyTree, tenantId, payload)."
        }
      ]
    }
  }
];
