import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_LOGIN_DEFAULTS,
  authConfigInternals,
} from "../../cloudflare-worker/src/auth-config.js";

test("auth login defaults match approved launch providers", () => {
  assert.deepEqual(AUTH_LOGIN_DEFAULTS.providers, {
    email: true,
    google: true,
    guest: true,
    phone: false,
    facebook: false,
    apple: false,
  });
  assert.equal(AUTH_LOGIN_DEFAULTS.optionalAccountLinking, false);
});

test("auth login config normalizes missing fields to safe defaults", () => {
  assert.deepEqual(authConfigInternals.normalizeConfig({
    providers: { phone: true, email: false },
    optionalAccountLinking: true,
  }), {
    providers: {
      email: false,
      google: true,
      guest: true,
      phone: true,
      facebook: false,
      apple: false,
    },
    optionalAccountLinking: true,
  });
});

test("auth login config rejects disabling every provider", () => {
  assert.throws(
    () => authConfigInternals.validateConfigInput({
      providers: {
        email: false,
        google: false,
        guest: false,
        phone: false,
        facebook: false,
        apple: false,
      },
      optionalAccountLinking: false,
    }),
    /at_least_one_provider_required/,
  );
});

test("auth login config management requires owner or manageSystem", () => {
  assert.equal(authConfigInternals.canManageAuthConfig({ role: "owner" }), true);
  assert.equal(authConfigInternals.canManageAuthConfig({
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageSystem"],
  }), true);
  assert.equal(authConfigInternals.canManageAuthConfig({
    role: "admin",
    adminEnabled: true,
    capabilities: [],
  }), false);
});
